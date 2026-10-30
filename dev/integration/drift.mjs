import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { caddyGet, caddyPatch, caddyPost } from '../../src/backend/src/caddy.js';
import { readContainerFile, writeContainerFile } from '../../src/backend/src/containerFs.js';
import { useTestStack } from './stack.mjs';

const root = resolve(import.meta.dirname, '../..');

test('real Caddy route mutations explain only their own changes in the drift monitor', { timeout: 120000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-ui-drift-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const entry = join(directory, 'backend.mjs');
    const moduleUrl = file => pathToFileURL(join(root, file)).href;
    // Exercise the production backend and its actual monitor state. A temporary
    // launcher lets this scenario request checks over its existing IPC channel,
    // without a test endpoint, environment switch or a minute-long timer wait.
    await writeFile(entry, `
        await import(${JSON.stringify(moduleUrl('src/backend/src/index.js'))});
        const drift = await import(${JSON.stringify(moduleUrl('src/backend/src/configDrift.js'))});
        process.on('message', async message => {
            if (message?.type !== 'test:drift') return;
            try {
                if (message.baseline) drift.resetConfigDrift();
                await drift.checkAllInstances();
                process.send({ type: 'test:drift-result', state: drift.getConfigDriftState('default') });
            } catch (error) {
                process.send({ type: 'test:drift-result', error: error.name });
            }
        });
    `);
    const stack = await useTestStack(t, { backendEntry: entry });
    const instance = stack.instances.get('alpha').instance;
    const original = await readContainerFile(instance.containerName, instance.configPath);
    const local = { '@id': 'drift-local', handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:9' }] }] };
    const other = { '@id': 'drift-other', match: [{ host: ['other.test'] }], handle: [{ handler: 'static_response', body: 'original' }] };
    const adminUrl = instance.adminUrl;
    const append = route => caddyPost(`/config/apps/http/servers/${instance.serverName}/routes`, route, adminUrl);
    async function check(baseline = false) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => finish(new Error('Drift IPC check timed out')), 15000);
            const onMessage = message => {
                if (message?.type === 'test:drift-result') finish(message.error && new Error(message.error), message.state);
            };
            function finish(error, state) {
                clearTimeout(timeout);
                stack.backend.removeListener('message', onMessage);
                if (error) reject(error);
                else resolve(state);
            }
            stack.backend.on('message', onMessage);
            stack.backend.send({ type: 'test:drift', baseline }, error => { if (error) finish(error); });
        });
    }
    async function mutate(operation, id) {
        const result = await stack.api(operation === 'add' ? '/routes' : `/routes/${id}`, {
            method: { add: 'POST', replace: 'PATCH', remove: 'DELETE' }[operation],
            ...(operation === 'remove' ? {} : { body: { domain: 'local.test', upstream: '127.0.0.1:10' } }),
        });
        assert.ok([200, 201].includes(result.status), JSON.stringify(result.data));
        assert.equal(result.data.verification.live, 'verified');
        return result;
    }
    for (const diskBacked of [false, true]) {
        for (const operation of diskBacked ? ['add', 'replace', 'remove'] : ['replace', 'remove']) {
            for (const external of [false, true]) {
                // Restore through the normal authenticated API, then arrange
                // the fixture's initial routes before establishing a baseline.
                const restored = await stack.api('/caddyfile?fmt=false&sort=false', { method: 'PUT', body: original, plain: true });
                assert.equal(restored.status, 200);
                if (diskBacked && operation !== 'add') {
                    await append({ ...local, match: [{ host: ['local.test'] }] });
                    await writeContainerFile(instance.containerName, instance.configPath,
                        original + '\nlocal.test {\n    reverse_proxy 127.0.0.1:9\n}\n');
                } else if (!diskBacked) await append(local);
                await append(other);
                await check(true);
                if (external) await caddyPatch('/id/drift-other', { ...other, handle: [{ handler: 'static_response', body: 'external' }] }, adminUrl);
                await mutate(operation, local['@id']);
                await check();
                const state = await check();
                const label = `${operation}, disk=${diskBacked}, external=${external}`;
                assert.deepEqual(state.changes.map(change => change.representations), external ? [['live']] : [], label);
                if (external) {
                    assert.equal((await caddyGet('/id/drift-other', adminUrl)).handle[0].body, 'external');
                    // Undo only the external edit. The local mutation remains,
                    // so an unchanged baseline would still report drift here.
                    await caddyPatch('/id/drift-other', other, adminUrl);
                    await check();
                    await caddyPatch('/id/drift-other', { ...other, handle: [{ handler: 'static_response', body: 'external' }] }, adminUrl);
                    assert.equal((await check()).changes.length, 2, label);
                }
            }
        }
    }
    await t.test('an API-only edit cannot approve an external file edit', async () => {
        const restored = await stack.api('/caddyfile?fmt=false&sort=false', { method: 'PUT', body: original, plain: true });
        assert.equal(restored.status, 200);
        await append(local);
        await check(true);
        await writeContainerFile(instance.containerName, instance.configPath, original + '\n# external edit\n');
        await mutate('replace', local['@id']);
        assert.deepEqual((await check()).changes.map(change => change.representations), [['file']]);
        assert.equal((await check()).changes.length, 1);
    });
});

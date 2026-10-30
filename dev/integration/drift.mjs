import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { caddyGet, caddyGetConfig, caddyPatch, caddyPost } from '../../src/backend/src/caddy.js';
import { readContainerFile, writeContainerFile } from '../../src/backend/src/containerFs.js';
import { FixtureScope } from './lifecycle.mjs';
import { useTestStack } from './stack.mjs';

const root = resolve(import.meta.dirname, '../..');

async function readLiveConfig(adminUrl) {
    // Reloads replace Caddy's admin server asynchronously. An idle connection
    // can close just as this fixture reuses it. Retry this read once on a fresh
    // connection; mutation requests must retain their uncertain-write semantics.
    try {
        return await caddyGetConfig(adminUrl);
    } catch (error) {
        if (error.cause?.code !== 'UND_ERR_SOCKET') throw error;
        return caddyGetConfig(adminUrl);
    }
}

test('drift fixture retries a closed configuration read without hiding persistent or response errors', async t => {
    const scope = new FixtureScope(t.signal);
    t.after(() => scope.close());
    for (const failure of ['socket', 'persistent socket', 'HTTP', 'JSON']) {
        await t.test(failure, async () => {
            let requests = 0;
            const server = await scope.acquire(async () => {
                const server = createServer((req, res) => {
                    requests++;
                    assert.equal(req.method, 'GET');
                    assert.equal(req.url, '/config/');
                    if (failure === 'persistent socket' || (failure === 'socket' && requests === 1)) {
                        req.socket.destroy();
                        return;
                    }
                    res.writeHead(failure === 'HTTP' ? 503 : 200, { ETag: '"fixture"' });
                    res.end(failure === 'JSON' ? 'invalid JSON' : '{"apps":{}}');
                });
                server.listen(0, '127.0.0.1');
                await once(server, 'listening');
                return server;
            }, async server => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
            const url = `http://127.0.0.1:${server.address().port}`;
            if (failure === 'socket') {
                assert.deepEqual(await readLiveConfig(url), { config: { apps: {} }, fingerprint: 'etag:"fixture"' });
            } else {
                await assert.rejects(readLiveConfig(url), error => failure === 'HTTP' ? error.status === 503
                    : failure === 'JSON' ? error instanceof SyntaxError : error.cause?.code === 'UND_ERR_SOCKET');
            }
            assert.equal(requests, failure.includes('socket') ? 2 : 1);
        });
    }
});

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
        const nativeFetch = globalThis.fetch;
        let failNextConfigRead = false;
        globalThis.fetch = (url, options) => {
            if (failNextConfigRead && String(url).endsWith('/config/')) {
                failNextConfigRead = false;
                return Promise.reject(new TypeError('Injected unavailable drift read'));
            }
            return nativeFetch(url, options);
        };
        const drift = await import(${JSON.stringify(moduleUrl('src/backend/src/configDrift.js'))});
        const { hasUnsettledWrites } = await import(${JSON.stringify(moduleUrl('src/backend/src/caddy.js'))});
        const { getInstances } = await import(${JSON.stringify(moduleUrl('src/backend/src/instances.js'))});
        const { getRecentLogEntries } = await import(${JSON.stringify(moduleUrl('src/backend/src/logger.js'))});
        process.on('message', async message => {
            if (message?.type !== 'test:drift') return;
            try {
                if (message.baseline) drift.resetConfigDrift();
                if (message.failRead) failNextConfigRead = true;
                const deferred = getInstances().some(instance => hasUnsettledWrites(instance.adminUrl));
                await drift.checkAllInstances();
                process.send({ type: 'test:drift-result', id: message.id,
                    state: drift.getConfigDriftState('default'), deferred,
                    diagnostics: getRecentLogEntries().filter(entry => entry.message.startsWith('Configuration drift')).slice(-5) });
            } catch (error) {
                process.send({ type: 'test:drift-result', id: message.id, error: error.name });
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
    let nextCheck = 0;
    let unavailableSamples = 0;
    function requestCheck(baseline, failRead, timeoutMs) {
        const id = ++nextCheck;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => finish(new Error('Drift IPC check timed out')), timeoutMs);
            const onMessage = message => {
                if (message?.type === 'test:drift-result' && message.id === id) finish(message.error && new Error(message.error), message);
            };
            function finish(error, result) {
                clearTimeout(timeout);
                stack.backend.removeListener('message', onMessage);
                if (error) reject(error);
                else resolve(result);
            }
            stack.backend.on('message', onMessage);
            stack.backend.send({ type: 'test:drift', id, baseline, failRead }, error => { if (error) finish(error); });
        });
    }
    async function check(baseline = false, { expectedLive, failRead = false } = {}) {
        const deadline = Date.now() + 15000;
        let result;
        do {
            result = await requestCheck(baseline, failRead, Math.max(1, deadline - Date.now()));
            // A reset or injected outage applies to the first request only.
            baseline = false;
            failRead = false;
            assert.ok(result.state, 'The monitor must establish a baseline');
            if (result.state.failing) unavailableSamples++;
            if (!result.deferred && !result.state.failing && (!expectedLive || result.state.expected.live === expectedLive)) {
                return result.state;
            }
            await delay(25, undefined, { signal: t.signal });
        } while (Date.now() < deadline);
        assert.fail(`No completed drift observation matching ${expectedLive || 'an available read'}: ${JSON.stringify(result)}`);
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
                    const revertedFingerprint = (await readLiveConfig(adminUrl)).fingerprint;
                    // An unavailable/deferred check retains the previous
                    // report. Observe the clean state before changing it again,
                    // and exercise that contract with a one-shot read outage.
                    const reverted = await check(false, { expectedLive: revertedFingerprint, failRead: operation === 'remove' });
                    assert.equal(reverted.changes.length, 1, label);
                    await caddyPatch('/id/drift-other', { ...other, handle: [{ handler: 'static_response', body: 'external' }] }, adminUrl);
                    assert.equal((await check()).changes.length, 2, label);
                }
            }
        }
    }
    assert.ok(unavailableSamples >= 2, 'Both injected read outages must be retried as observations, not counted as completed checks');
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

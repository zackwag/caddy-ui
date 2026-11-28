import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { caddyGet, caddyGetConfig, caddyPatch, caddyPost } from '../../src/backend/src/caddy.js';
import { checkDrift, driftCheckingBackend, useTestStack } from './stack.mjs';

// The fixture's reads go through caddy.js, which resends a read once when
// Caddy closes the connection while a reload replaces its admin server.

test('real Caddy route mutations explain only their own changes in the drift monitor', { timeout: 120000 }, async t => {
    const stack = await useTestStack(t, { backendEntry: await driftCheckingBackend(t) });
    const instance = stack.instances.get('alpha').instance;
    const original = await stack.harness.readConfig('alpha');
    const local = { '@id': 'drift-local', handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:9' }] }] };
    const other = { '@id': 'drift-other', match: [{ host: ['other.test'] }], handle: [{ handler: 'static_response', body: 'original' }] };
    const adminUrl = instance.adminUrl;
    const append = route => caddyPost(`/config/apps/http/servers/${instance.serverName}/routes`, route, adminUrl);
    let unavailableSamples = 0;
    async function check(baseline = false, { expectedLive, failRead = false } = {}) {
        const deadline = Date.now() + 15000;
        let result;
        do {
            result = await checkDrift(stack.backend, { reset: baseline, failRead }, Math.max(1, deadline - Date.now()));
            // A reset or injected outage applies to the first request only.
            baseline = false;
            failRead = false;
            assert.ok(result.state, 'The monitor must establish a baseline');
            if (result.state.failing) {
                unavailableSamples++;
            }
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
                    await stack.harness.writeConfig('alpha',
                        original + '\nlocal.test {\n    reverse_proxy 127.0.0.1:9\n}\n');
                } else if (!diskBacked) {
                    await append(local);
                }
                await append(other);
                await check(true);
                if (external) {
                    await caddyPatch('/id/drift-other', { ...other, handle: [{ handler: 'static_response', body: 'external' }] }, adminUrl);
                }
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
                    const revertedFingerprint = (await caddyGetConfig(adminUrl)).fingerprint;
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
        await stack.harness.writeConfig('alpha', original + '\n# external edit\n');
        await mutate('replace', local['@id']);
        assert.deepEqual((await check()).changes.map(change => change.representations), [['file']]);
        assert.equal((await check()).changes.length, 1);
    });
});

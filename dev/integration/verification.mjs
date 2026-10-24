import assert from 'node:assert/strict';
import test from 'node:test';
import { useTestStack } from './stack.mjs';

const verified = { file: 'verified', live: 'verified' };

test('configuration changes read back as verified from real Caddy', { timeout: 90000 }, async t => {
    const stack = await useTestStack(t);
    const original = (await stack.api('/caddyfile')).data;
    const expectVerified = (response, label, verification = verified) => {
        assert.ok(response.status === 200 || response.status === 201, `${label}: ${JSON.stringify(response.data)}`);
        assert.deepEqual(response.data.verification, verification, label);
        assert.equal(response.data.warningCode, undefined, label);
    };

    // Formatting and sorting change the text, so the readback must use the
    // final content, and the live config must match Caddy's own adaptation.
    const unformatted = original.replace(/^ {4}/gm, '\t') + '\nverified.test {\nrespond "ok"\n}\n';
    expectVerified(await stack.api('/caddyfile', { method: 'PUT', body: unformatted, plain: true }), 'editor save with fmt and sort');

    expectVerified(await stack.api('/caddyfile/reloads', { method: 'POST' }), 'reload from disk', { file: 'unchanged', live: 'verified' });
    expectVerified(await stack.api('/metrics/config', { method: 'PUT', body: { enabled: true } }), 'metrics toggle');

    const added = await stack.api('/routes', { method: 'POST', body: { domain: 'added.test', upstream: '127.0.0.1:9' } });
    expectVerified(added, 'route added through the admin API');
    expectVerified(await stack.api(`/routes/${added.data.id}`, { method: 'PATCH', body: { domain: 'added.test', upstream: '127.0.0.1:10' } }), 'route updated through the admin API');
    expectVerified(await stack.api(`/routes/${added.data.id}`, { method: 'DELETE' }), 'route deleted through the admin API');

    // A force save Caddy rejects keeps the file but doesn't claim it applied.
    const forced = await stack.api('/caddyfile?fmt=false&sort=false&validate=false', { method: 'PUT', body: 'broken.test {\n\tnot_a_directive\n}\n', plain: true });
    assert.equal(forced.status, 200, JSON.stringify(forced.data));
    assert.deepEqual(forced.data.verification, { file: 'verified', live: 'not-applied' });

    expectVerified(await stack.api('/caddyfile?fmt=false&sort=false&action=restore', { method: 'PUT', body: original, plain: true }), 'restore');
});

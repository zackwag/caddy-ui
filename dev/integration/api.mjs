import assert from 'node:assert/strict';
import test from 'node:test';
import { useTestStack } from './stack.mjs';

test('sessions and CSRF guard configuration commands and unavailable reads before instance lookup', { timeout: 60000 }, async t => {
    const stack = await useTestStack(t);
    const original = (await stack.api('/caddyfile')).data;
    for (const path of ['/health', '/routes/maintenance', '/metrics/raw', '/routes', '/tls', '/route-notes', '/caddyfile/history']) {
        for (const instanceId of ['default', 'unknown-instance']) {
            const response = await fetch(stack.url + '/api' + path, { headers: { 'X-Instance-Id': instanceId } });
            assert.equal(response.status, 401, path);
            assert.equal((await response.json()).code, 'UNAUTHORIZED');
        }
    }
    const context = await fetch(stack.url + '/api/auth/csrf');
    const cookie = context.headers.getSetCookie().at(-1).split(';')[0];
    const csrf = (await context.json()).csrfToken;
    const paths = [
        ['PUT', '/caddyfile?fmt=false&sort=false'],
        ['POST', '/routes'],
        ['PATCH', '/routes/example-route'],
        ['DELETE', '/routes/example-route'],
        ['PATCH', '/routes/caddyfile/example.test'],
        ['DELETE', '/routes/caddyfile/example.test'],
        ['PUT', '/logs/config'],
        ['PUT', '/metrics/config'],
        ['PUT', '/route-notes/example.test'],
        ['DELETE', '/tls/example.test'],
        ['POST', '/routes/caddyfile/example.test/maintenance'],
        ['DELETE', '/routes/caddyfile/example.test/maintenance'],
        ['DELETE', '/instances/default'],
    ];
    for (const [method, path] of paths) {
        const response = await fetch(stack.url + '/api' + path, { method, headers: { Cookie: cookie, 'X-CSRF-Token': csrf } });
        assert.equal(response.status, 401, path);
    }
    const login = await fetch(stack.url + '/api/auth/sessions', { method: 'POST',
        headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(stack.credentials) });
    assert.equal(login.status, 200);
    const authenticated = login.headers.getSetCookie().at(-1).split(';')[0];
    for (const [method, path] of paths) {
        const response = await fetch(stack.url + '/api' + path, { method, headers: { Cookie: authenticated } });
        assert.equal(response.status, 403, path);
        assert.equal((await response.json()).code, 'CSRF_INVALID');
    }
    const unknown = await fetch(stack.url + '/api/routes/maintenance', {
        headers: { Cookie: authenticated, 'X-Instance-Id': 'unknown-instance' },
    });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).code, 'INSTANCE_SELECTION_INVALID');
    assert.equal((await stack.api('/routes/maintenance')).status, 200);
    assert.equal((await stack.api('/instances')).data.length, 1);
    assert.equal((await stack.api('/caddyfile')).data, original, 'Rejected writes leave the Caddyfile unchanged');
});

test('real backend: container lifecycle and UI registration are independent', { timeout: 120000 }, async t => {
    const stack = await useTestStack(t);
    let alpha = stack.instances.get('alpha');
    const beta = await stack.create('beta');
    assert.equal((await stack.api('/instances')).data.length, 1);
    const registration = await stack.api('/instances', { method: 'POST', body: beta.instance });
    assert.equal(registration.status, 201);
    const betaId = registration.data.id;
    const original = (await stack.api('/caddyfile')).data;
    const changed = original.replace('test instance: alpha', 'test instance: saved-alpha');
    assert.equal((await stack.api('/caddyfile?fmt=false&sort=false', { method: 'PUT', body: changed, plain: true })).status, 200);
    assert.match(await (await fetch(alpha.httpUrl)).text(), /saved-alpha/);
    assert.match((await stack.api('/caddyfile', { instanceId: betaId })).data, /test instance: beta/);
    await fetch(beta.httpUrl + '/error?case=beta-only');
    assert((await stack.api('/logs', { instanceId: betaId })).data.lines.some(line => line.includes('beta-only')));
    assert(!(await stack.api('/logs')).data.lines.some(line => line.includes('beta-only')));

    await stack.harness.stop('alpha');
    assert.equal((await stack.harness.inspect('container', stack.harness.resource('alpha'))).State.Running, false);
    assert.equal((await stack.api('/instances')).data.length, 2);
    assert.equal((await stack.api('/caddyfile')).status, 500);
    alpha = await stack.create('alpha');
    await stack.api('/instances/default', { method: 'PUT', body: { adminUrl: alpha.instance.adminUrl } });
    assert.equal((await stack.api('/caddyfile')).data, changed);
    await stack.harness.remove('alpha');
    assert.equal((await stack.api('/instances')).data.length, 2);
    alpha = await stack.create('alpha');
    await stack.api('/instances/default', { method: 'PUT', body: { adminUrl: alpha.instance.adminUrl } });
    assert.equal((await stack.api('/caddyfile')).data, changed);
    assert.equal((await stack.api('/instances/' + betaId, { method: 'DELETE' })).status, 200);
    const stale = await stack.api('/caddyfile?fmt=false&sort=false', { method: 'PUT', body: 'stale', plain: true, instanceId: betaId });
    assert.equal(stale.status, 404);
    assert.equal(stale.data.code, 'INSTANCE_SELECTION_INVALID');
    assert.equal((await stack.api('/caddyfile')).data, changed);
    assert.equal((await stack.harness.inspect('container', stack.harness.resource('beta'))).State.Running, true);
    assert.equal((await stack.api('/instances/default', { method: 'DELETE' })).status, 200);
    assert.equal((await stack.api('/caddyfile')).data.code, 'NO_INSTANCES');
    assert.equal((await stack.api('/logs/app')).status, 200);
    await stack.close();
    assert.deepEqual(await stack.harness.names(), []);
    assert.deepEqual(await stack.harness.names('volume'), []);
});

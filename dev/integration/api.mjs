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
    const issued = await stack.api('/auth/tokens', { method: 'POST', body: {
        name: 'Boundary checks', scopes: ['status:read', 'metrics:read'], instanceIds: ['default'], expiresInDays: 1,
    } });
    assert.equal(issued.status, 201);
    const managementContext = await fetch(stack.url + '/api/auth/csrf', { headers: { Cookie: authenticated } });
    const managementCsrf = (await managementContext.json()).csrfToken;
    for (const [method, path] of [...paths, ...['/routes', '/tls', '/route-notes', '/caddyfile/history'].map(path => ['GET', path])]) {
        // A restricted bearer remains restricted even beside a valid admin
        // session and CSRF context; the shared save helper must never run.
        const response = await fetch(stack.url + '/api' + path, { method, headers: {
            Authorization: 'Bearer ' + issued.data.token, Cookie: authenticated, 'X-CSRF-Token': managementCsrf,
        } });
        assert.equal(response.status, 403, path);
        assert.equal((await response.json()).code, 'FORBIDDEN');
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
    const betaToken = await stack.api('/auth/tokens', { method: 'POST', body: {
        name: 'Beta status', scopes: ['status:read'], instanceIds: [betaId], expiresInDays: 1,
    } });
    assert.equal(betaToken.status, 201);
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
    const staleToken = await fetch(stack.url + '/api/status', {
        headers: { Authorization: 'Bearer ' + betaToken.data.token, 'X-Instance-Id': betaId },
    });
    assert.equal(staleToken.status, 404);
    assert.equal((await staleToken.json()).code, 'INSTANCE_SELECTION_INVALID');
    const stale = await stack.api('/caddyfile?fmt=false&sort=false', { method: 'PUT', body: 'stale', plain: true, instanceId: betaId });
    assert.equal(stale.status, 404);
    assert.equal(stale.data.code, 'INSTANCE_SELECTION_INVALID');
    assert.equal((await stack.api('/caddyfile')).data, changed);
    assert.equal((await stack.harness.inspect('container', stack.harness.resource('beta'))).State.Running, true);
    assert.equal((await stack.api('/instances/default', { method: 'DELETE' })).status, 200);
    assert.equal((await stack.api('/caddyfile')).data.code, 'NO_INSTANCES');
    assert.equal((await stack.api('/logs/app')).status, 200);
    assert.equal((await stack.api('/notifications/config')).status, 200);
    await stack.close();
    assert.deepEqual(await stack.harness.names(), []);
    assert.deepEqual(await stack.harness.names('volume'), []);
});

test('logging changes preserve literal content, nested globals and named loggers with real Caddy', { timeout: 60000 }, async t => {
    const stack = await useTestStack(t);
    const { instance, httpUrl } = stack.instances.get('alpha');
    const original = (await stack.api('/caddyfile')).data;
    const literal = '{\n"example": "log { is response text"\n}';
    const snippet = '(literal-response) {\nrespond /literal <<BODY\n' + literal + '\nBODY\n}\n';
    const global = `{ # preserve this brace in a comment: {
admin 0.0.0.0:2019
auto_https off
servers {
timeouts {
read_body 10s
}
}
storage file_system {
root "/data/dev-caddy/caddy{state"
}
log audit {
output file /data/dev-caddy/logs/audit.log
format json
}
}\n\n`;
    // This is a known fixture boundary, not application-side Caddyfile parsing.
    const site = original.slice(original.indexOf(':80 {')).replace('    respond /health', '    import literal-response\n    respond /health');
    const saved = await stack.api('/caddyfile?fmt=false&sort=false', { method: 'PUT', body: snippet + global + site, plain: true });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const live = async () => (await fetch(instance.adminUrl + '/config/')).json();
    const before = await live();
    const runtimePath = '/data/dev-caddy/logs/runtime.log';
    assert.equal((await stack.api('/instances/default', { method: 'PUT', body: { logPath: runtimePath } })).status, 200);
    const settings = { enabled: true, path: runtimePath, rollSize: '25mb', rollKeep: 3, format: 'json', level: 'INFO' };

    for (const format of ['json', 'console']) {
        const response = await stack.api('/logs/config', { method: 'PUT', body: { ...settings, format } });
        assert.equal(response.status, 200, JSON.stringify(response.data));
        assert.deepEqual((await stack.api('/logs/config')).data, { ...settings, format });
        const editedFile = (await stack.api('/caddyfile')).data;
        assert.ok(editedFile.startsWith(snippet + global.slice(0, global.lastIndexOf('}'))), 'Existing global directives and snippet formatting remain byte-for-byte unchanged');
        assert.ok(editedFile.endsWith(site), 'Site formatting remains byte-for-byte unchanged');
        const after = await live();
        assert.deepEqual(after.apps, before.apps, 'Logging edits preserve sites and their handlers');
        assert.deepEqual(after.storage, before.storage, 'Quoted literal braces survive editing');
        assert.deepEqual(after.logging.logs.audit, before.logging.logs.audit, 'Named loggers remain unchanged');
        assert.equal(await (await fetch(httpUrl + '/literal')).text(), literal, 'Heredoc bytes remain unchanged');
        assert.ok((await stack.api('/logs')).data.lines.length > 0, 'The runtime file writer is active');
    }

    const currentFile = (await stack.api('/caddyfile')).data;
    const currentConfig = await live();
    const invalid = await stack.api('/logs/config', { method: 'PUT', body: { ...settings, format: 'missing-encoder' } });
    assert.equal(invalid.status, 422);
    assert.equal(invalid.data.code, 'CADDYFILE_VALIDATION_FAILED');
    assert.equal((await stack.api('/caddyfile')).data, currentFile);
    assert.deepEqual(await live(), currentConfig);

    const disabled = await stack.api('/logs/config', { method: 'PUT', body: { enabled: false } });
    assert.equal(disabled.status, 200);
    assert.equal((await stack.api('/logs/config')).data.enabled, false);
    assert.ok((await stack.api('/caddyfile')).data.endsWith(site), 'Disabling logging preserves site formatting');
    const after = await live();
    assert.deepEqual(after.apps, before.apps);
    assert.deepEqual(after.logging.logs.audit, before.logging.logs.audit);
    assert.equal(await (await fetch(httpUrl + '/literal')).text(), literal);
});

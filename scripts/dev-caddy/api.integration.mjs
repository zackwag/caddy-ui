import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { Harness } from './harness.mjs';
import { startTestStack } from './test-stack.mjs';

test('real backend: container lifecycle and UI registration are independent', { timeout: 120000 }, async t => {
    const stack = await startTestStack();
    t.after(() => stack.close());
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
    assert.equal((await stack.harness.inspect('container', stack.harness.resource('beta'))).State.Running, true);
    assert.equal((await stack.api('/instances/default', { method: 'DELETE' })).status, 200);
    assert.equal((await stack.api('/caddyfile')).data.code, 'NO_INSTANCES');
    assert.equal((await stack.api('/logs/app')).status, 200);
    await stack.close();
    assert.deepEqual(await stack.harness.names(), []);
    assert.deepEqual(await stack.harness.names('volume'), []);
});

test('failed backend startup still removes its Caddy containers and volumes', { timeout: 60000 }, async () => {
    const project = randomBytes(8).toString('hex');
    await assert.rejects(startTestStack({ project, backendEntry: 'nonexistent-integration-entry.mjs' }), /Integration startup failed/);
    const harness = new Harness(project);
    assert.deepEqual(await harness.names(), []);
    assert.deepEqual(await harness.names('volume'), []);
});

test('fixture refuses a namespace already used by another test stack', { timeout: 60000 }, async t => {
    const stack = await startTestStack();
    t.after(() => stack.close());
    await assert.rejects(startTestStack({ project: stack.harness.project }), /fresh, empty Docker namespace/);
    assert.equal((await stack.harness.inspect('container', stack.harness.resource('alpha'))).State.Running, true);
    assert.equal((await stack.api('/caddyfile')).status, 200);
});

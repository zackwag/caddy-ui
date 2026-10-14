// Opt-in real Docker smoke test. Uses a fresh namespace and always cleans it up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { checkDocker, docker, Harness } from '../../scripts/dev-caddy/harness.mjs';
import { FixtureScope } from './lifecycle.mjs';
import { claimNamespace, waitForHttp } from './stack.mjs';

test('real Caddy: isolation, reload, logs, restart/recreation persistence, cleanup', { timeout: 120000 }, async t => {
    const scope = new FixtureScope(t.signal);
    t.after(() => scope.close());
    await scope.run(() => checkDocker());
    const harness = new Harness(randomBytes(8).toString('hex'));
    await scope.acquire(() => claimNamespace(harness), id => harness.run(['rm', id]));
    scope.defer(() => harness.removeAll({ confirmed: true, purge: true }));
    const response = url => waitForHttp(url, { signal: scope.signal });
    let alpha = await scope.run(() => harness.create('alpha'));
    const beta = await scope.run(() => harness.create('beta'));
    assert.equal(await (await response(alpha.httpUrl + '/health')).text(), 'ok');
    assert.match(await (await response(beta.httpUrl)).text(), /beta/);
    const file = await docker(['exec', harness.resource('alpha'), 'cat', alpha.instance.configPath]);
    const updated = file.replace('Caddy UI test instance: alpha', 'persisted integration edit');
    await docker(['exec', harness.resource('alpha'), 'sh', '-c', 'printf "%s" "$1" > /data/dev-caddy/Caddyfile', 'sh', updated]);
    await docker(['exec', harness.resource('alpha'), 'caddy', 'reload', '--config', alpha.instance.configPath, '--adapter', 'caddyfile']);
    assert.equal(await (await response(alpha.httpUrl)).text(), 'persisted integration edit');
    assert.equal((await fetch(alpha.httpUrl + '/error')).status, 503);
    assert.match(await docker(['exec', harness.resource('alpha'), 'cat', alpha.instance.logPath]), /\/error/);
    assert.match(await (await response(beta.httpUrl)).text(), /beta/);
    await harness.stop('alpha');
    assert.equal((await harness.inspect('container', harness.resource('alpha'))).State.Running, false);
    alpha = await scope.run(() => harness.create('alpha'));
    assert.equal(await (await response(alpha.httpUrl)).text(), 'persisted integration edit');
    await harness.remove('alpha');
    alpha = await scope.run(() => harness.create('alpha'));
    assert.equal(await (await response(alpha.httpUrl)).text(), 'persisted integration edit');
    await scope.close();
    assert.deepEqual(await harness.names(), []);
    assert.deepEqual(await harness.names('volume'), []);
});

// Opt-in real Docker smoke test. Uses a fresh namespace and always cleans it up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { checkDocker, docker, Harness } from './harness.mjs';

async function response(url) {
    for (let i = 0; i < 40; i++) {
        try {
            const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
            if (r.ok) return r;
        } catch { /* Container may still be starting. */ }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Caddy never became ready at ${url}`);
}

test('real Caddy: isolation, reload, logs, restart/recreation persistence, cleanup', async () => {
    await checkDocker();
    const h = new Harness(randomBytes(8).toString('hex'));
    try {
        let alpha = await h.create('alpha');
        const beta = await h.create('beta');
        assert.equal(await (await response(alpha.httpUrl + '/health')).text(), 'ok');
        assert.match(await (await response(beta.httpUrl)).text(), /beta/);
        const file = await docker(['exec', h.resource('alpha'), 'cat', alpha.instance.configPath]);
        const updated = file.replace('Caddy UI test instance: alpha', 'persisted integration edit');
        await docker(['exec', h.resource('alpha'), 'sh', '-c', 'printf "%s" "$1" > /data/dev-caddy/Caddyfile', 'sh', updated]);
        await docker(['exec', h.resource('alpha'), 'caddy', 'reload', '--config', alpha.instance.configPath, '--adapter', 'caddyfile']);
        assert.equal(await (await response(alpha.httpUrl)).text(), 'persisted integration edit');
        assert.equal((await fetch(alpha.httpUrl + '/error')).status, 503);
        assert.match(await docker(['exec', h.resource('alpha'), 'cat', alpha.instance.logPath]), /\/error/);
        assert.match(await (await response(beta.httpUrl)).text(), /beta/);
        await h.stop('alpha');
        assert.equal((await h.inspect('container', h.resource('alpha'))).State.Running, false);
        alpha = await h.create('alpha');
        assert.equal(await (await response(alpha.httpUrl)).text(), 'persisted integration edit');
        await h.remove('alpha');
        alpha = await h.create('alpha');
        assert.equal(await (await response(alpha.httpUrl)).text(), 'persisted integration edit');
        await h.removeAll({ confirmed: true, purge: true });
        assert.deepEqual(await h.names(), []);
        assert.deepEqual(await h.names('volume'), []);
    } finally {
        await h.removeAll({ confirmed: true, purge: true });
    }
});

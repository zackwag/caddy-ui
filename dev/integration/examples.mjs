import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { request } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { EXAMPLE_SITES, createExampleInstance } from '../dev-caddy/examples.mjs';
import { Harness, checkDocker, defaultCaddyfile } from '../dev-caddy/harness.mjs';
import { FixtureScope } from './lifecycle.mjs';
import { claimNamespace, waitForHttp } from './stack.mjs';

async function requestSite(url, ca, domain, signal) {
    const deadline = Date.now() + 15000;
    while (true) {
        try { return await requestReadySite(url, ca, domain, signal, Math.max(1, Math.min(5000, deadline - Date.now()))); }
        catch (error) {
            // HTTP readiness and a CA certificate don't prove that Caddy has
            // issued this hostname's leaf certificate yet. Retry only startup
            // transport failures; CA/hostname validation and HTTP assertions
            // retain their normal failures.
            const starting = ['ECONNREFUSED', 'ECONNRESET'].includes(error.code)
                || (error.code === 'EPROTO' && /alert internal error|SSL alert number 80/.test(error.message));
            if (!starting || Date.now() >= deadline) throw error;
            await delay(50, undefined, { signal });
        }
    }
}

function requestReadySite(url, ca, domain, signal, timeout) {
    return new Promise((resolve, reject) => {
        const req = request(url, { ca, servername: domain, headers: { Host: domain }, timeout, signal }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('error', reject);
            response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
        });
        req.on('timeout', () => req.destroy(new Error('Example HTTPS request timed out')));
        req.on('error', reject);
        req.end();
    });
}

test('shared real examples serve trusted TLS and preserve edited or retained Caddyfiles', { timeout: 120000 }, async t => {
    const scope = new FixtureScope(t.signal);
    t.after(() => scope.close());
    await scope.run(() => checkDocker());
    const harness = new Harness(randomBytes(8).toString('hex'));
    await scope.acquire(() => claimNamespace(harness), id => harness.run(['rm', id]));
    scope.defer(() => harness.removeAll({ confirmed: true, purge: true }));
    const create = name => scope.run(() => createExampleInstance(harness, name));
    const ready = info => waitForHttp(info.httpUrl + '/health', { signal: scope.signal });
    const readConfig = info => harness.run(['exec', info.instance.containerName, 'cat', info.instance.configPath]);

    let info = await create('default');
    assert.equal(await (await ready(info)).text(), 'ok');
    assert.equal((await fetch(info.httpUrl + '/error')).status, 503);
    const caResponse = await waitForHttp(info.instance.adminUrl + '/pki/ca/local', { signal: scope.signal });
    const { root_certificate: ca } = await caResponse.json();
    assert(ca);
    for (const site of EXAMPLE_SITES) {
        const response = await requestSite(info.httpsUrl, ca, site.domain, scope.signal);
        assert.equal(response.status, 200);
        assert.equal(response.body, 'OK');
    }

    const edited = (await readConfig(info)).replace('# Home Assistant', '# My edited application');
    await harness.run(['exec', info.instance.containerName, 'sh', '-c', 'printf "%s" "$1" > /data/dev-caddy/Caddyfile', 'sh', edited]);
    await harness.run(['exec', info.instance.containerName, 'caddy', 'reload', '--config', info.instance.configPath, '--adapter', 'caddyfile']);
    await create('default');
    assert.equal(await readConfig(info), edited.trim());
    await scope.run(() => harness.stop('default'));
    info = await create('default');
    await ready(info);
    assert.equal(await readConfig(info), edited.trim());
    await scope.run(() => harness.remove('default'));
    info = await create('default');
    await ready(info);
    assert.equal(await readConfig(info), edited.trim());
    assert.equal((await requestSite(info.httpsUrl, ca, 'example.com', scope.signal)).status, 200, 'The original local CA survives recreation');

    // An upstream IP change can't be followed into preserved edits; it warns.
    const address = edited.match(/reverse_proxy (\S+):8123/)[1];
    const moved = edited.replaceAll(address + ':', '10.255.255.1:');
    await harness.run(['exec', info.instance.containerName, 'sh', '-c', 'printf "%s" "$1" > /data/dev-caddy/Caddyfile', 'sh', moved]);
    const warn = t.mock.method(console, 'warn', () => {});
    await create('default');
    assert.equal(warn.mock.callCount(), 1);
    assert.match(warn.mock.calls[0].arguments[0], new RegExp(`proxies to 10\\.255\\.255\\.1, but example-upstream is now at ${address.replaceAll('.', '\\.')}`));
    warn.mock.restore();

    // A retained basic instance is also user state, not permission to seed over it.
    const old = await scope.run(() => harness.create('old-default'));
    await ready(old);
    await scope.run(() => harness.remove('old-default'));
    const quiet = t.mock.method(console, 'warn', () => {});
    const retained = await create('old-default');
    assert.equal(quiet.mock.callCount(), 0, 'A basic Caddyfile has no example addresses to warn about');
    quiet.mock.restore();
    await ready(retained);
    assert.equal(await readConfig(retained), defaultCaddyfile('old-default').trim());
    await scope.close();
    assert.deepEqual(await harness.names(), []);
    assert.deepEqual(await harness.names('volume'), []);
});

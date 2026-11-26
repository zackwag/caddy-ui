import assert from 'node:assert/strict';
import { request } from 'node:https';
import test from 'node:test';
import { EXAMPLE_SITES, createExampleInstance } from '../dev-caddy/examples.mjs';
import { defaultCaddyfile, until } from '../dev-caddy/harness.mjs';
import { FixtureScope } from './lifecycle.mjs';
import { acquireHarness, waitForHttp } from './stack.mjs';

function requestSite(url, ca, domain, signal) {
    // HTTP readiness and a CA certificate don't prove that Caddy has issued
    // this hostname's leaf certificate yet. Retry only startup transport
    // failures; CA/hostname validation and HTTP assertions retain their
    // normal failures.
    const starting = error => ['ECONNREFUSED', 'ECONNRESET'].includes(error.code)
        || (error.code === 'EPROTO' && /alert internal error|SSL alert number 80/.test(error.message));
    return until(remaining => requestReadySite(url, ca, domain, signal, Math.min(5000, remaining)), () => true,
        { signal, intervalMs: 50, retry: starting, message: `${domain} was not served over HTTPS` });
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
    const harness = await acquireHarness(scope);
    const create = name => scope.run(() => createExampleInstance(harness, name));
    const ready = info => waitForHttp(info.httpUrl + '/health', { signal: scope.signal });

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

    const edited = (await harness.readConfig('default')).replace('# Home Assistant', '# My edited application');
    await harness.writeConfig('default', edited);
    await harness.run(['exec', info.instance.containerName, 'caddy', 'reload', '--config', info.instance.configPath, '--adapter', 'caddyfile']);
    await create('default');
    assert.equal(await harness.readConfig('default'), edited);
    await scope.run(() => harness.stop('default'));
    info = await create('default');
    await ready(info);
    assert.equal(await harness.readConfig('default'), edited);
    await scope.run(() => harness.remove('default'));
    info = await create('default');
    await ready(info);
    assert.equal(await harness.readConfig('default'), edited);
    assert.equal((await requestSite(info.httpsUrl, ca, 'example.com', scope.signal)).status, 200, 'The original local CA survives recreation');

    // An upstream IP change can't be followed into preserved edits; it warns.
    const address = edited.match(/reverse_proxy (\S+):8123/)[1];
    const moved = edited.replaceAll(address + ':', '10.255.255.1:');
    await harness.writeConfig('default', moved);
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
    assert.equal(await harness.readConfig('old-default'), defaultCaddyfile('old-default'));
    await scope.close();
    assert.deepEqual(await harness.names(), []);
    assert.deepEqual(await harness.names('volume'), []);
});

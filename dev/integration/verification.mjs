import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { useTestStack } from './stack.mjs';

const verified = { file: 'verified', live: 'verified' };
const HOP_HEADERS = ['host', 'connection', 'content-length', 'transfer-encoding', 'content-encoding', 'keep-alive'];
const withoutHopHeaders = headers => Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_HEADERS.includes(name.toLowerCase())));

// Forwards the backend's admin API requests to real Caddy and records them.
// `beforeNext(matches, change)` runs `change` once, ahead of forwarding the
// first request that matches, so another client's change lands between the
// backend's read and its conditional write without depending on timing.
async function adminProxy(t, target) {
    const requests = [];
    let hook = null;
    const server = createServer(async (req, res) => {
        try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const request = { method: req.method, url: req.url, ifMatch: req.headers['if-match'] };
            requests.push(request);
            if (hook?.matches(request)) {
                const { change } = hook;
                hook = null;
                await change();
            }
            const response = await fetch(target + req.url, {
                method: req.method, headers: withoutHopHeaders(req.headers), body: chunks.length ? Buffer.concat(chunks) : undefined,
            });
            const body = Buffer.from(await response.arrayBuffer());
            res.writeHead(response.status, withoutHopHeaders(Object.fromEntries(response.headers)));
            res.end(body);
        } catch (error) {
            res.writeHead(502).end(String(error?.message ?? error));
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
        server.closeAllConnections();
        return new Promise(resolve => server.close(resolve));
    });
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        beforeNext(matches, change) { hook = { matches, change }; },
    };
}

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

test('admin API route edits fail instead of overwriting a concurrent change in real Caddy', { timeout: 90000 }, async t => {
    const stack = await useTestStack(t);
    const { adminUrl } = stack.instances.get('alpha').instance;
    const proxy = await adminProxy(t, adminUrl);
    assert.equal((await stack.api('/instances/default', { method: 'PUT', body: { adminUrl: proxy.url } })).status, 200);
    const caddy = (path, init = {}) => fetch(adminUrl + path, {
        ...init, headers: { 'Content-Type': 'application/json', Origin: 'http://0.0.0.0:2019' },
    });
    const route = async id => (await caddy(`/id/${id}`)).json();
    const conditionalWrite = (method, pattern) => request => request.method === method && pattern.test(request.url) && Boolean(request.ifMatch);
    const expectConflict = async (response, label) => {
        assert.equal(response.status, 409, `${label}: ${JSON.stringify(response.data)}`);
        assert.equal(response.data.code, 'CONFIG_CHANGED', label);
    };

    const added = await stack.api('/routes', { method: 'POST', body: { domain: 'conflict.test', upstream: '127.0.0.1:9' } });
    assert.equal(added.status, 201, JSON.stringify(added.data));
    assert.deepEqual(added.data.verification, verified);
    const { id } = added.data;
    const file = (await stack.api('/caddyfile')).data;

    // Another client changes the route between the backend's read and its write
    const external = { ...await route(id), terminal: false };
    proxy.beforeNext(conditionalWrite('PATCH', new RegExp(`^/id/${id}$`)), async () => {
        assert.equal((await caddy(`/id/${id}`, { method: 'PATCH', body: JSON.stringify(external) })).status, 200);
    });
    const patches = () => proxy.requests.filter(request => request.method === 'PATCH').length;
    const patchesBefore = patches();
    await expectConflict(await stack.api(`/routes/${id}`, { method: 'PATCH', body: { domain: 'conflict.test', upstream: '127.0.0.1:10' } }), 'stale update');
    assert.equal(patches() - patchesBefore, 1, 'a refused update is not retried');
    assert.deepEqual(await route(id), external, 'the concurrent change is kept');
    assert.equal((await stack.api('/caddyfile')).data, file, 'the Caddyfile is restored');

    proxy.beforeNext(conditionalWrite('DELETE', new RegExp(`^/id/${id}$`)), async () => {
        assert.equal((await caddy(`/id/${id}`, { method: 'PATCH', body: JSON.stringify({ ...external, terminal: true }) })).status, 200);
    });
    await expectConflict(await stack.api(`/routes/${id}`, { method: 'DELETE' }), 'stale delete');
    assert.equal((await route(id)).terminal, true, 'the route survives a refused delete');
    assert.equal((await stack.api('/caddyfile')).data, file);

    proxy.beforeNext(conditionalWrite('POST', /\/routes$/), async () => {
        const unrelated = { '@id': 'external-route', match: [{ host: ['external.test'] }], handle: [{ handler: 'static_response', body: 'external' }] };
        assert.equal((await caddy('/config/apps/http/servers/srv0/routes', { method: 'POST', body: JSON.stringify(unrelated) })).status, 200);
    });
    await expectConflict(await stack.api('/routes', { method: 'POST', body: { domain: 'late.test', upstream: '127.0.0.1:9' } }), 'stale add');
    assert.equal((await stack.api('/caddyfile')).data, file);
    const routes = JSON.stringify(await (await caddy('/config/apps/http/servers')).json());
    assert.ok(!routes.includes('late.test') && routes.includes('external.test'), 'the refused route is absent and the concurrent one kept');

    // Unchanged since the read, the same conditional writes succeed
    const updated = await stack.api(`/routes/${id}`, { method: 'PATCH', body: { domain: 'conflict.test', upstream: '127.0.0.1:10' } });
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    assert.deepEqual(updated.data.verification, verified);
    const deleted = await stack.api(`/routes/${id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
    assert.deepEqual(deleted.data.verification, verified);
    assert.ok(proxy.requests.some(request => request.method === 'PATCH' && request.ifMatch), 'writes carried If-Match');
});

test('editor saves refuse to overwrite a Caddyfile changed since it was loaded', { timeout: 90000 }, async t => {
    const stack = await useTestStack(t);
    const { instance } = stack.instances.get('alpha');
    const loaded = await stack.api('/caddyfile');
    const etag = loaded.headers.get('etag');
    assert.match(etag, /^"sha256:[0-9a-f]{64}"$/);
    const save = (content, ifMatch) => stack.api('/caddyfile?fmt=false&sort=false', {
        method: 'PUT', body: content, plain: true, headers: ifMatch ? { 'If-Match': ifMatch } : {},
    });
    const live = async () => (await fetch(instance.adminUrl + '/config/')).json();
    const versions = async () => (await stack.api('/caddyfile/history')).data.length;

    // Someone edits the file on the host after the editor loaded it
    const external = loaded.data.replace('Caddy UI test instance:', 'external-edit:');
    await stack.harness.run(['exec', instance.containerName, 'sh', '-c', 'printf "%s" "$1" > "$2"', 'sh', external, instance.configPath]);
    const [running, saved] = [await live(), await versions()];
    const refused = await save(loaded.data.replace('Caddy UI test instance:', 'editor-edit:'), etag);
    assert.equal(refused.status, 409, JSON.stringify(refused.data));
    assert.equal(refused.data.code, 'CADDYFILE_CHANGED');
    assert.equal((await stack.api('/caddyfile')).data, external, 'the external edit is kept');
    assert.deepEqual(await live(), running, 'nothing was reloaded');
    assert.equal(await versions(), saved, 'no history version was recorded');

    // Based on the current file, including the weak form a compressing proxy sends
    const current = (await stack.api('/caddyfile')).headers.get('etag');
    assert.notEqual(current, etag);
    const accepted = await save(external.replace('external-edit:', 'merged-edit:'), `W/${current}`);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.deepEqual(accepted.data.verification, verified);

    // Without If-Match the save behaves as before
    assert.equal((await save(loaded.data)).status, 200);
    assert.equal((await stack.api('/caddyfile')).data, loaded.data);
});

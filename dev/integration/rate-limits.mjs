import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backendEnvironment } from '../dev-caddy/harness.mjs';
import { FixtureScope } from './lifecycle.mjs';
import { startBackend } from './stack.mjs';
import { createAuthStore } from '../../src/backend/src/authStore.js';

function call(base, path, { headers = {}, method = 'GET', body } = {}) {
    return new Promise((resolve, reject) => {
        const req = request(base + path, { method, headers }, res => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
        });
        req.setTimeout(5000, () => req.destroy(new Error('Request timed out')));
        req.on('error', reject);
        req.end(body);
    });
}

async function backend(t, trustedProxies = '') {
    const scope = new FixtureScope(t.signal);
    t.after(() => scope.close());
    const directory = await mkdtemp(join(tmpdir(), 'caddy-login-limit-'));
    scope.defer(() => rm(directory, { recursive: true, force: true }));
    const env = { ...backendEnvironment(directory, {}), PORT: '0', LOG_LEVEL: 'error', CADDY_UI_TRUSTED_PROXIES: trustedProxies };
    for (const key of ['CADDY_UI_USER', 'CADDY_UI_PASSWORD', 'JWT_SECRET', 'CADDY_UI_EXTERNAL_URL', 'CADDY_UI_PUBLIC_METRICS']) delete env[key];
    await mkdir(join(directory, 'backend'));
    await writeFile(env.INSTANCES_PATH, '[]');
    const credentials = { username: 'administrator', password: randomBytes(24).toString('base64url') };
    const store = createAuthStore(env.AUTH_PATH);
    await store.loadAuth();
    await store.initializeAuth(credentials.username, credentials.password);
    return { ...await startBackend(scope, { env }), credentials };
}

async function loginClient(url) {
    // The normal pre-login context is public; it must not bypass throttling.
    const response = await fetch(url + '/api/auth/csrf');
    const cookie = response.headers.getSetCookie().at(-1).split(';')[0];
    const csrf = (await response.json()).csrfToken;
    return (forwarded, password = 'incorrect-password') => call(url, '/api/auth/sessions', {
        method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrf,
            'Content-Type': 'application/json', ...(forwarded ? { 'X-Forwarded-For': forwarded } : {}) },
        body: JSON.stringify({ username: 'administrator', password }),
    });
}

describe('real backend login rate limits', () => {
    it('refuses to start with an invalid proxy trust setting', async t => {
        await assert.rejects(backend(t, 'true'), /CADDY_UI_TRUSTED_PROXIES/);
    });

    it('keeps direct clients throttled when they rotate forwarding headers', async t => {
        const { url, credentials, output } = await backend(t);
        assert.equal((await call(url, '/api/version', { headers: {
            'X-Forwarded-For': '192.0.2.1', Forwarded: 'for=198.51.100.1', 'X-Real-IP': '203.0.113.1',
        } })).status, 200);
        const login = await loginClient(url);
        for (let i = 1; i <= 15; i++) assert.equal((await login(`192.0.2.${i}`)).status, 401);
        for (const forwarded of [undefined, '198.51.100.1', '203.0.113.1, 198.51.100.2']) {
            assert.equal((await login(forwarded)).status, 429);
        }
        assert.equal((await login('198.51.100.3', credentials.password)).status, 429);
        assert.doesNotMatch(output(), /ERR_ERL_UNEXPECTED_X_FORWARDED_FOR/);
        assert.doesNotMatch(output(), /ERR_ERL_FORWARDED_HEADER/);
    });

    it('keeps distinct client budgets behind a configured proxy', { timeout: 15000 }, async t => {
        const { url, credentials } = await backend(t, '127.0.0.1');
        // Two controlled proxy fixtures represent separate verified clients.
        // Their identities are fixture configuration, never request input.
        async function proxyFor(clientIp) {
            const proxy = createServer((req, res) => {
                const upstream = request(url + req.url, { method: req.method,
                    headers: { ...req.headers, 'x-forwarded-for': clientIp } }, response => {
                    res.writeHead(response.statusCode, response.headers); response.pipe(res);
                });
                upstream.on('error', error => res.destroy(error));
                res.on('close', () => upstream.destroy());
                req.pipe(upstream);
            });
            t.after(async () => { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); });
            proxy.listen(0, '127.0.0.1');
            await once(proxy, 'listening');
            return loginClient(`http://127.0.0.1:${proxy.address().port}`);
        }
        const first = await proxyFor('192.0.2.1');
        for (let i = 1; i <= 15; i++) assert.equal((await first(`203.0.113.${i}`)).status, 401);
        assert.equal((await first('198.51.100.1')).status, 429);
        const second = await proxyFor('192.0.2.2');
        assert.equal((await second('198.51.100.2', credentials.password)).status, 200);
    });

    it('ignores direct forwarding headers when only another peer is trusted', { timeout: 15000 }, async t => {
        const { url } = await backend(t, '192.0.2.99');
        const login = await loginClient(url);
        for (let i = 1; i <= 15; i++) assert.equal((await login(`203.0.113.${i}`)).status, 401);
        assert.equal((await login('198.51.100.1')).status, 429);
    });

    it('does not let direct clients reset the general API budget either', async t => {
        const { url } = await backend(t);
        for (let i = 0; i < 200; i++) {
            assert.equal((await call(url, '/api/version', { headers: { 'X-Forwarded-For': `192.0.2.${i + 1}` } })).status, 200);
        }
        assert.equal((await call(url, '/api/version', { headers: { 'X-Forwarded-For': '198.51.100.1' } })).status, 429);
    });
});

import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backendEnvironment } from '../../../dev/dev-caddy/harness.mjs';
import { createAuthStore } from '../src/authStore.js';

const disposers = [];
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose(); });

function call(base, path, { localAddress = '127.0.0.1', headers = {}, method = 'GET', body } = {}) {
    return new Promise((resolve, reject) => {
        const req = request(base + path, { method, headers, localAddress }, res => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
        });
        req.setTimeout(5000, () => req.destroy(new Error('Request timed out')));
        req.on('error', reject);
        req.end(body);
    });
}

async function backend(trustedProxies = '') {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-login-limit-'));
    disposers.push(() => rm(directory, { recursive: true, force: true }));
    const env = { ...backendEnvironment(directory, {}), PORT: '0', LOG_LEVEL: 'error', CADDY_UI_TRUSTED_PROXIES: trustedProxies };
    for (const key of ['CADDY_UI_USER', 'CADDY_UI_PASSWORD', 'JWT_SECRET', 'CADDY_UI_EXTERNAL_URL', 'CADDY_UI_PUBLIC_METRICS']) delete env[key];
    await mkdir(join(directory, 'backend'));
    await writeFile(env.INSTANCES_PATH, '[]');
    const credentials = { username: 'administrator', password: randomBytes(24).toString('base64url') };
    const store = createAuthStore(env.AUTH_PATH);
    await store.loadAuth();
    await store.initializeAuth(credentials.username, credentials.password);
    const child = fork(new URL('../src/index.js', import.meta.url), [], { env, silent: true });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-8000); });
    disposers.push(async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        const force = setTimeout(() => child.kill('SIGKILL'), 2000);
        try { await exited; } finally { clearTimeout(force); }
    });
    const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(reject, new Error('Backend readiness timeout: ' + output)), 10000);
        const message = value => { if (value.type === 'caddy-ui:listening') finish(resolve, value.port); };
        const exited = () => finish(reject, new Error('Backend exited before readiness: ' + output));
        function finish(settle, value) {
            clearTimeout(timer); child.removeListener('message', message); child.removeListener('exit', exited); settle(value);
        }
        child.on('message', message); child.once('exit', exited);
    });
    return { url: `http://127.0.0.1:${port}`, credentials, output: () => output };
}

async function loginClient(url, localAddress = '127.0.0.1') {
    // The normal pre-login context is public; it must not bypass throttling.
    const response = await fetch(url + '/api/auth/csrf');
    const cookie = response.headers.getSetCookie().at(-1).split(';')[0];
    const csrf = (await response.json()).csrfToken;
    return (forwarded, password = 'incorrect-password') => call(url, '/api/auth/sessions', {
        localAddress, method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrf,
            'Content-Type': 'application/json', ...(forwarded ? { 'X-Forwarded-For': forwarded } : {}) },
        body: JSON.stringify({ username: 'administrator', password }),
    });
}

describe('real backend login rate limits', () => {
    it('refuses to start with an invalid proxy trust setting', async () => {
        await expect(backend('true')).rejects.toThrow('CADDY_UI_TRUSTED_PROXIES');
    }, 15000);

    it('keeps direct clients throttled when they rotate forwarding headers', async () => {
        const { url, credentials, output } = await backend();
        expect((await call(url, '/api/version', { headers: {
            'X-Forwarded-For': '192.0.2.1', Forwarded: 'for=198.51.100.1', 'X-Real-IP': '203.0.113.1',
        } })).status).toBe(200);
        const login = await loginClient(url);
        for (let i = 1; i <= 15; i++) expect((await login(`192.0.2.${i}`)).status).toBe(401);
        for (const forwarded of [undefined, '198.51.100.1', '203.0.113.1, 198.51.100.2']) {
            expect((await login(forwarded)).status).toBe(429);
        }
        expect((await login('198.51.100.3', credentials.password)).status).toBe(429);
        expect(output()).not.toContain('ERR_ERL_UNEXPECTED_X_FORWARDED_FOR');
        expect(output()).not.toContain('ERR_ERL_FORWARDED_HEADER');
    }, 15000);

    it('keeps distinct client budgets behind a configured proxy while ignoring untrusted direct headers', async () => {
        const { url, credentials } = await backend('127.0.0.2/32');
        // Simulate the shipped nginx policy: replace incoming forwarding input
        // with the actual client address, and connect from the trusted peer.
        const proxy = createServer((req, res) => {
            const upstream = request(url + req.url, { method: req.method, localAddress: '127.0.0.2',
                headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress } }, response => {
                res.writeHead(response.statusCode, response.headers); response.pipe(res);
            });
            upstream.on('error', error => res.destroy(error));
            res.on('close', () => upstream.destroy());
            req.pipe(upstream);
        });
        disposers.push(async () => { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); });
        proxy.listen(0, '127.0.0.1');
        await once(proxy, 'listening');
        const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
        const first = await loginClient(proxyUrl, '127.0.0.3');
        for (let i = 1; i <= 15; i++) expect((await first(`192.0.2.${i}`)).status).toBe(401);
        expect((await first('198.51.100.1')).status).toBe(429);
        const second = await loginClient(proxyUrl, '127.0.0.4');
        expect((await second('198.51.100.2', credentials.password)).status).toBe(200);

        const direct = await loginClient(url);
        for (let i = 1; i <= 15; i++) expect((await direct(`203.0.113.${i}`)).status).toBe(401);
        expect((await direct('198.51.100.3')).status).toBe(429);
    }, 15000);

    it('does not let direct clients reset the general API budget either', async () => {
        const { url } = await backend();
        for (let i = 0; i < 200; i++) {
            expect((await call(url, '/api/version', { headers: { 'X-Forwarded-For': `192.0.2.${i + 1}` } })).status).toBe(200);
        }
        expect((await call(url, '/api/version', { headers: { 'X-Forwarded-For': '198.51.100.1' } })).status).toBe(429);
    }, 15000);
});

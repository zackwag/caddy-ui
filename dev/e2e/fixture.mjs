import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, request } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { backendEnvironment } from '../dev-caddy/harness.mjs';
import { FixtureScope } from '../integration/lifecycle.mjs';
import { createTestStack, waitForBackendPort, waitForContainerNetwork } from '../integration/stack.mjs';

const frontend = resolve(import.meta.dirname, '../../src/frontend');

export function prepareBrowserTests() {
    return promisify(execFile)(process.execPath, ['scripts/fetch-caddyfile-mode.mjs'], { cwd: frontend, timeout: 30000 });
}

// One scenario owns the whole stack. No page, registry, locale or viewport state
// survives into the next scenario, including after failure or cancellation.
export async function useBrowserFixture(t, options) {
    const scope = new FixtureScope(t.signal);
    const pageErrors = [];
    const requests = [];
    t.after(async () => {
        await scope.close();
        assert.deepEqual(pageErrors, [], 'Uncaught browser JavaScript errors');
    });


    const stack = await createTestStack(scope, options);
    await scope.run(() => waitForContainerNetwork(stack.instances.get('alpha').instance.containerName, { signal: scope.signal }));
    const vite = await scope.acquire(() => createServer({
        root: frontend,
        cacheDir: resolve(stack.directory, 'vite-cache'),
        server: { host: '127.0.0.1', port: 0, proxy: { '/api': stack.url } },
    }), vite => vite.close());
    await scope.run(() => vite.listen());
    const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
    const browser = await scope.acquire(() => chromium.launch({
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    }), browser => browser.close());
    const context = await scope.acquire(() => browser.newContext({ viewport: { width: 1440, height: 900 } }), context => context.close());
    const csrf = await context.request.get(origin + '/api/auth/csrf');
    const login = await context.request.post(origin + '/api/auth/sessions', {
        headers: { 'X-CSRF-Token': (await csrf.json()).csrfToken }, data: stack.credentials,
    });
    assert.equal(login.status(), 200, 'Browser fixture login');
    const page = await scope.run(() => context.newPage());
    page.setDefaultTimeout(10000);
    const record = entry => {
        requests.push(entry);
        if (requests.length > 80) requests.shift();
    };
    let networkChanged;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => record({ url: request.url() }));
    page.on('response', response => record({ url: response.url(), status: response.status() }));
    page.on('requestfailed', request => {
        if (request.failure()?.errorText === 'net::ERR_NETWORK_CHANGED') networkChanged = true;
        record({ url: request.url(), failure: request.failure() });
    });
    page.on('console', message => { if (message.type() === 'error') record({ error: message.text() }); });

    async function waitForView(selector) {
        try { await page.locator(selector).waitFor(); }
        catch (error) {
            const body = await page.locator('body').innerText().catch(() => '<page unavailable>');
            const logs = await stack.api('/logs/app').catch(() => ({ data: null }));
            throw new Error(`${selector} did not become ready at ${page.url()}\n${body}\n${JSON.stringify(requests.slice(-40))}\n${JSON.stringify(logs.data?.entries?.slice(-30))}`, { cause: error });
        }
    }

    // Docker interface creation can invalidate Chromium's network state. Retry
    // only initial navigation for that transport error; assertions run once.
    for (let attempt = 0; attempt < 3; attempt++) {
        networkChanged = false;
        try {
            await scope.run(() => page.goto(origin + '/dashboard', { waitUntil: 'domcontentloaded' }));
            await waitForView('.shell');
            break;
        } catch (error) {
            if (!networkChanged || attempt === 2) throw error;
        }
    }
    return { stack, page, context, origin, waitForView };
}

// Real backend and frontend, with an empty instance registry: auth needs no Docker.
export async function useAuthBrowserFixture(t, legacy = false, { https = false, configurePasskeys = true, httpsHostname = 'localhost' } = {}) {
    const root = resolve(import.meta.dirname, '../..');
    const secret = () => randomBytes(24).toString('base64url');
    const scope = new FixtureScope(t.signal);
    t.after(() => scope.close());
    const directory = await scope.acquire(() => mkdtemp(join(tmpdir(), 'caddy-auth-browser-')), value => rm(value, { recursive: true, force: true }));
    let vite;
    let tls;
    let certificatePin;
    if (https) {
        const key = join(directory, 'key.pem');
        const cert = join(directory, 'cert.pem');
        await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
            '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { timeout: 10000 });
        tls = { key: await readFile(key), cert: await readFile(cert) };
        certificatePin = createHash('sha256').update(new X509Certificate(tls.cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    }
    let target;
    const proxy = await scope.acquire(async () => {
        const handler = (req, res) => {
            if (!req.url.startsWith('/api/')) return vite.middlewares(req, res);
            if (!target) { res.writeHead(502); return res.end(); }
            const upstream = request(target + req.url, { method: req.method, headers: req.headers }, response => {
                res.writeHead(response.statusCode, response.headers);
                response.pipe(res);
            });
            upstream.on('error', () => { res.writeHead(502); res.end(); });
            res.on('close', () => upstream.destroy());
            req.pipe(upstream);
        };
        const server = tls ? createHttpsServer(tls, handler) : createHttpServer(handler);
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        return server;
    }, async value => { value.closeAllConnections(); await new Promise(resolve => value.close(resolve)); });
    vite = await scope.acquire(() => createServer({ root: join(root, 'src/frontend'),
        server: { middlewareMode: true, hmr: false, ws: { server: proxy } }, cacheDir: join(directory, 'vite-cache'),
    }), value => value.close());
    // HTTP scenarios use an untrustworthy origin; HTTPS pins only this fixture's certificate.

    const origin = https ? `https://${httpsHostname}:${proxy.address().port}` : new URL(`http://[::ffff:127.0.0.1]:${proxy.address().port}`).origin;
    const env = { ...backendEnvironment(directory, {}), PORT: '0', CADDY_UI_EXTERNAL_URL: origin,
        AUTH_PATH: join(directory, 'backend/auth.json') };
    if (!configurePasskeys) delete env.CADDY_UI_EXTERNAL_URL;
    for (const key of ['CADDY_UI_USER', 'CADDY_UI_PASSWORD', 'JWT_SECRET']) delete env[key];
    const previous = { username: 'legacy-administrator', password: secret() };
    if (legacy) Object.assign(env, { CADDY_UI_USER: previous.username, CADDY_UI_PASSWORD: previous.password, JWT_SECRET: secret() });
    await mkdir(join(directory, 'backend'));
    await writeFile(env.INSTANCES_PATH, '[]');
    const metadata = JSON.stringify({ firstTimeRun: false, language: 'en', theme: 'dark', routeColumns: { id: false } });
    await writeFile(env.SETTINGS_PATH, metadata);
    let output = '';
    let backend;
    async function startBackend() {
        backend = await scope.acquire(() => fork(join(root, 'src/backend/src/index.js'), [], { cwd: root, env, silent: true }), stopBackend);
        backend.stdout.on('data', chunk => { output = (output + chunk).slice(-32000); });
        backend.stderr.on('data', chunk => { output = (output + chunk).slice(-32000); });
        const failed = new AbortController();
        backend.once('exit', () => failed.abort(new Error('Backend exited before readiness: ' + output)));
        target = 'http://127.0.0.1:' + await waitForBackendPort(backend, { signal: AbortSignal.any([scope.signal, failed.signal]) });
    }
    async function stopBackend(child) {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
        try { await exited; } finally { clearTimeout(timer); }
    }
    await startBackend();
    const browser = await scope.acquire(() => chromium.launch({
        ...(certificatePin ? { args: ['--ignore-certificate-errors-spki-list=' + certificatePin] } : {}),
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    }), value => value.close());
    const context = await scope.acquire(() => browser.newContext({ viewport: { width: 1440, height: 900 } }), value => value.close());
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const pageErrors = [];
    const urls = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', req => urls.push(req.url()));
    t.after(() => assert.deepEqual(pageErrors, []));
    await page.goto(origin);
    return { page, context, previous, origin, urls, env, metadata,
        async restart() { await stopBackend(backend); await startBackend(); },
        disconnect() { target = null; } };
}

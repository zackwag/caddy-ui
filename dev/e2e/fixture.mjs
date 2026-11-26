import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { launchChromium } from '../browser.mjs';
import { createServer } from 'vite';
import { isolatedBackendEnvironment } from '../dev-caddy/harness.mjs';
import { FixtureScope } from '../integration/lifecycle.mjs';
import { createTestStack, forward, serveLoopback, startBackend, stopProcess, waitForContainerNetwork } from '../integration/stack.mjs';

const frontend = resolve(import.meta.dirname, '../../src/frontend');

// The editor's generated syntax mode, fetched once per scenario file.
let prepared;
function prepareFrontend() {
    return prepared ??= promisify(execFile)(process.execPath, ['scripts/fetch-caddyfile-mode.mjs'], { cwd: frontend, timeout: 30000 });
}

// A one-day certificate for localhost, and the SPKI pin Chromium trusts it by.
export async function selfSignedCertificate(directory) {
    const key = join(directory, 'key.pem');
    const cert = join(directory, 'cert.pem');
    await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
        '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { timeout: 10000 });
    const tls = { key: await readFile(key), cert: await readFile(cert) };
    const pin = createHash('sha256').update(new X509Certificate(tls.cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    return { tls, pin };
}

// Signs `context` in through the API, or enrolls `credentials` as the first administrator.
export async function apiSignIn(context, origin, credentials, { enroll = false } = {}) {
    const csrf = await context.request.get(origin + '/api/auth/csrf');
    const response = await context.request.post(origin + (enroll ? '/api/auth/setup' : '/api/auth/sessions'), {
        headers: { 'X-CSRF-Token': (await csrf.json()).csrfToken }, data: credentials,
    });
    assert.equal(response.status(), 200, `${enroll ? 'Enrollment' : 'Sign-in'} through the API: ${await response.text()}`);
}

// One scenario owns the whole stack. No page, registry, locale or viewport state
// survives into the next scenario, including after failure or cancellation.
export async function useBrowserFixture(t, options) {
    await prepareFrontend();
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
    const browser = await scope.acquire(() => launchChromium(), browser => browser.close());
    const context = await scope.acquire(() => browser.newContext({ viewport: { width: 1440, height: 900 } }), context => context.close());
    await apiSignIn(context, origin, stack.credentials);
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
export async function useAuthBrowserFixture(t, { legacy = false, https = false, configurePasskeys = true, httpsHostname = 'localhost', frontendVersion } = {}) {
    await prepareFrontend();
    const root = resolve(import.meta.dirname, '../..');
    const secret = () => randomBytes(24).toString('base64url');
    const scope = new FixtureScope(t.signal);
    t.after(() => scope.close());
    const directory = await scope.acquire(() => mkdtemp(join(tmpdir(), 'caddy-auth-browser-')), value => rm(value, { recursive: true, force: true }));
    let vite;
    const { tls, pin } = https ? await selfSignedCertificate(directory) : {};
    let target;
    const proxy = await serveLoopback(scope, (req, res) => {
        if (!req.url.startsWith('/api/')) {
            return vite.middlewares(req, res);
        }
        if (!target) {
            res.writeHead(502);
            return res.end();
        }
        forward(req, res, target);
    }, tls);
    vite = await scope.acquire(() => createServer({ root: join(root, 'src/frontend'),
        ...(frontendVersion === undefined ? {} : { define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(frontendVersion) } }),
        server: { middlewareMode: true, hmr: false, ws: { server: proxy } }, cacheDir: join(directory, 'vite-cache'),
    }), value => value.close());
    // HTTP scenarios use an untrustworthy origin; HTTPS pins only this fixture's certificate.

    const origin = https ? `https://${httpsHostname}:${proxy.address().port}` : new URL(`http://[::ffff:127.0.0.1]:${proxy.address().port}`).origin;
    const previous = { username: 'legacy-administrator', password: secret() };
    const env = isolatedBackendEnvironment(directory, {}, {
        ...(configurePasskeys ? { CADDY_UI_EXTERNAL_URL: origin } : {}),
        ...(legacy ? { CADDY_UI_USER: previous.username, CADDY_UI_PASSWORD: previous.password, JWT_SECRET: secret() } : {}),
    });
    await mkdir(join(directory, 'backend'));
    await writeFile(env.INSTANCES_PATH, '[]');
    const metadata = JSON.stringify({ firstTimeRun: false, language: 'en', theme: 'dark', routeColumns: { id: false } });
    await writeFile(env.SETTINGS_PATH, metadata);
    let backend;
    async function start() {
        ({ backend, url: target } = await startBackend(scope, { env }));
    }
    await start();
    const browser = await scope.acquire(() => launchChromium({ ...(pin ? { args: ['--ignore-certificate-errors-spki-list=' + pin] } : {}) }), value => value.close());
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
        async restart() { await stopProcess(backend); await start(); },
        disconnect() { target = null; } };
}

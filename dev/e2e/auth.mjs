import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { before } from 'node:test';
import { chromium } from 'playwright';
import { createServer as createVite } from 'vite';
import { backendEnvironment } from '../dev-caddy/harness.mjs';
import { FixtureScope } from '../integration/lifecycle.mjs';
import { waitForBackendPort } from '../integration/stack.mjs';
import { prepareBrowserTests } from './fixture.mjs';

before(prepareBrowserTests, { timeout: 35000 });

const root = resolve(import.meta.dirname, '../..');
const secret = () => randomBytes(24).toString('base64url');

// Real backend and frontend, with an empty instance registry: auth needs no Docker.
async function fixture(t, legacy = false) {
    const scope = new FixtureScope(t.signal);
    t.after(() => scope.close());
    const directory = await scope.acquire(() => mkdtemp(join(tmpdir(), 'caddy-auth-browser-')), value => rm(value, { recursive: true, force: true }));
    const vite = await scope.acquire(() => createVite({ root: join(root, 'src/frontend'),
        server: { middlewareMode: true, hmr: false }, cacheDir: join(directory, 'vite-cache'),
    }), value => value.close());
    let target;
    const proxy = await scope.acquire(async () => {
        const server = createServer((req, res) => {
            if (!req.url.startsWith('/api/')) return vite.middlewares(req, res);
            if (!target) { res.writeHead(502); return res.end(); }
            const upstream = request(target + req.url, { method: req.method, headers: req.headers }, response => {
                res.writeHead(response.statusCode, response.headers);
                response.pipe(res);
            });
            upstream.on('error', () => { res.writeHead(502); res.end(); });
            res.on('close', () => upstream.destroy());
            req.pipe(upstream);
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        return server;
    }, async value => { value.closeAllConnections(); await new Promise(resolve => value.close(resolve)); });
    // This is ordinary, non-trustworthy HTTP in Chromium, without security overrides.
    const origin = new URL(`http://[::ffff:127.0.0.1]:${proxy.address().port}`).origin;
    const env = { ...backendEnvironment(directory, {}), PORT: '0', CADDY_UI_EXTERNAL_URL: origin,
        AUTH_PATH: join(directory, 'backend/auth.json') };
    for (const key of ['CADDY_UI_USER', 'CADDY_UI_PASSWORD', 'JWT_SECRET']) delete env[key];
    const previous = { username: 'legacy-administrator', password: secret() };
    if (legacy) Object.assign(env, { CADDY_UI_USER: previous.username, CADDY_UI_PASSWORD: previous.password, JWT_SECRET: secret() });
    await mkdir(join(directory, 'backend'));
    await writeFile(env.INSTANCES_PATH, '[]');
    const metadata = JSON.stringify({ firstTimeRun: false, language: 'en', theme: 'dark', routeColumns: { id: false } });
    await writeFile(env.SETTINGS_PATH, metadata);
    let output = '';
    const backend = await scope.acquire(() => fork(join(root, 'src/backend/src/index.js'), [], { cwd: root, env, silent: true }), async child => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
        try { await exited; } finally { clearTimeout(timer); }
    });
    backend.stdout.on('data', chunk => { output = (output + chunk).slice(-32000); });
    backend.stderr.on('data', chunk => { output = (output + chunk).slice(-32000); });
    const failed = new AbortController();
    backend.once('exit', () => failed.abort(new Error('Backend exited before readiness: ' + output)));
    target = 'http://127.0.0.1:' + await waitForBackendPort(backend, { signal: AbortSignal.any([scope.signal, failed.signal]) });
    const browser = await scope.acquire(() => chromium.launch({
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
    return { page, context, previous, origin, urls, env, metadata, disconnect() { target = null; } };
}

async function completeSetup(page, password) {
    await page.getByLabel('Username', { exact: true }).fill('administrator');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password').fill(password);
    await page.getByRole('button', { name: 'Complete setup' }).click();
    const key = await page.getByLabel('Recovery key', { exact: true }).inputValue();
    assert(key.length > 40);
    await page.getByLabel('I have saved my recovery key').check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('.shell').waitFor();
    return key;
}

async function login(page, password, username = 'administrator') {
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('HTTP setup, session cookies, CSRF, logout and one-time recovery work in the real UI', { timeout: 60000 }, async t => {
    const f = await fixture(t);
    const { page, context } = f;
    await page.getByRole('heading', { name: 'Create administrator' }).waitFor();
    assert.equal(await page.evaluate(() => isSecureContext), false);
    await page.setViewportSize({ width: 390, height: 360 });
    await page.locator('.login-shell').evaluate(element => { element.scrollTop = 0; });
    assert((await page.locator('.login-card').boundingBox()).y >= 0, 'the form starts inside the viewport');
    const submit = page.getByRole('button', { name: 'Complete setup' });
    await submit.scrollIntoViewIfNeeded();
    const bounds = await submit.boundingBox();
    assert(bounds.y >= 0 && bounds.y + bounds.height <= 360, 'setup controls can scroll into view');
    const password = secret();
    const recoveryKey = await completeSetup(page, password);
    await page.setViewportSize({ width: 1440, height: 900 });
    const cookie = (await context.cookies()).find(value => value.name === 'caddy_ui_session');
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, false);
    assert.equal(cookie.sameSite, 'Strict');
    assert.equal(await page.evaluate(() => localStorage.getItem('caddy_ui_token')), null);
    assert.equal(await readFile(f.env.SETTINGS_PATH, 'utf8'), f.metadata);
    const forged = await page.evaluate(async () => (await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'de' }),
    })).status);
    assert.equal(forged, 403);
    assert.equal(await readFile(f.env.SETTINGS_PATH, 'utf8'), f.metadata);
    await page.reload();
    await page.locator('.shell').waitFor();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await login(page, secret());
    await page.getByRole('alert').filter({ hasText: 'Login failed' }).waitFor();
    await login(page, password);
    await page.locator('.shell').waitFor();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Use recovery key' }).click();
    await page.getByLabel('Recovery key', { exact: true }).fill(recoveryKey);
    const replacement = secret();
    await page.getByLabel('Password', { exact: true }).fill(replacement);
    await page.getByLabel('Confirm password').fill(replacement);
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await page.getByRole('heading', { name: 'Save your recovery key' }).waitFor();
    assert.notEqual(await page.getByLabel('Recovery key', { exact: true }).inputValue(), recoveryKey);
    await page.getByLabel('I have saved my recovery key').check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await login(page, replacement);
    await page.locator('.shell').waitFor();
    assert(f.urls.every(url => !/[?&]token=/.test(url)));
});

test('existing environment login enrolls credentials without changing installation metadata', { timeout: 60000 }, async t => {
    const { page, previous, env, metadata } = await fixture(t, true);
    await login(page, previous.password, previous.username);
    await page.getByRole('heading', { name: 'Create administrator' }).waitFor();
    await completeSetup(page, secret());
    assert.equal(await readFile(env.SETTINGS_PATH, 'utf8'), metadata);
});

test('Security sections update credentials on HTTP and preserve the current browser session', { timeout: 60000 }, async t => {
    const { page, context, env, metadata } = await fixture(t);
    const password = secret();
    await completeSetup(page, password);
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Security', exact: true });
    const user = dialog.getByRole('button', { name: 'User', exact: true });
    const tokens = dialog.getByRole('button', { name: 'API tokens', exact: true });
    assert.equal(await user.getAttribute('aria-expanded'), 'true');
    assert.equal(await tokens.getAttribute('aria-expanded'), 'false');
    assert.equal(await dialog.getByRole('button', { name: 'Auth Coming later', exact: true }).isDisabled(), true);
    assert.equal(await dialog.getByLabel('Username', { exact: true }).inputValue(), 'administrator');
    await user.press('Enter');
    assert.equal(await dialog.getByLabel('Username', { exact: true }).isVisible(), false);
    await user.press('Enter');
    await tokens.click();
    await dialog.getByText('No API tokens have been issued.').waitFor();
    await tokens.click();
    const save = dialog.getByRole('button', { name: 'Save', exact: true });
    assert.equal(await save.isDisabled(), true);
    await dialog.getByLabel('Username', { exact: true }).fill('renamed-admin');
    await dialog.getByLabel('Current password', { exact: true }).fill(secret());
    await save.click();
    await dialog.getByRole('alert').filter({ hasText: 'The current password is incorrect.' }).waitFor();
    assert.equal(await dialog.getByLabel('Current password', { exact: true }).inputValue(), '');
    const oldCookie = (await context.cookies()).find(cookie => cookie.name === 'caddy_ui_session').value;
    await dialog.getByLabel('Current password', { exact: true }).fill(password);
    const updated = page.waitForResponse(response => response.url().endsWith('/api/auth/credentials') && response.request().method() === 'PATCH');
    await save.click();
    assert.equal((await updated).status(), 200);
    await dialog.getByRole('status').filter({ hasText: 'Administrator credentials updated.' }).waitFor();
    assert.notEqual((await context.cookies()).find(cookie => cookie.name === 'caddy_ui_session').value, oldCookie);
    assert.equal(await readFile(env.SETTINGS_PATH, 'utf8'), metadata);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await page.locator('.shell').waitFor();
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    assert.equal(await dialog.getByLabel('Username', { exact: true }).inputValue(), 'renamed-admin');
    const replacement = secret();
    await dialog.getByLabel('Current password', { exact: true }).fill(password);
    await dialog.getByLabel('New password', { exact: true }).fill(replacement);
    await dialog.getByLabel('Confirm password', { exact: true }).fill(secret());
    await save.click();
    await dialog.getByRole('alert').filter({ hasText: 'The passwords do not match.' }).waitFor();
    await dialog.getByLabel('Confirm password', { exact: true }).fill(replacement);
    await page.route('**/api/auth/credentials', route => route.request().method() === 'PATCH'
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'AUTH_PERSISTENCE_FAILED' }) })
        : route.continue());
    await save.click();
    await dialog.getByRole('alert').filter({ hasText: 'Credentials could not be saved.' }).waitFor();
    assert.equal(await dialog.getByLabel('New password', { exact: true }).inputValue(), replacement);
    assert.equal(await dialog.getByLabel('Current password', { exact: true }).inputValue(), '');
    await page.unroute('**/api/auth/credentials');
    await dialog.getByLabel('Current password', { exact: true }).fill(password);
    await save.click();
    await dialog.getByRole('status').filter({ hasText: 'Administrator credentials updated.' }).waitFor();
    assert.equal(await dialog.getByLabel('New password', { exact: true }).inputValue(), '');
    assert.equal(await dialog.getByLabel('Confirm password', { exact: true }).inputValue(), '');
    // A token mutation needs a fresh CSRF value after the session was renewed.
    const nextWrite = await page.evaluate(async () => {
        const { apiFetch } = await import('/src/utils/api.js');
        return apiFetch('/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'en' }) });
    });
    assert.equal(nextWrite.language, 'en');
    await page.setViewportSize({ width: 390, height: 500 });
    const bounds = await dialog.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert(bounds.y >= 0 && bounds.y + bounds.height <= 500);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await login(page, password, 'renamed-admin');
    await page.getByRole('alert').filter({ hasText: 'Login failed' }).waitFor();
    await login(page, replacement, 'renamed-admin');
    await page.locator('.shell').waitFor();
});

test('backend failure presents a retry screen instead of entering the application', { timeout: 30000 }, async t => {
    const { page, disconnect } = await fixture(t);
    await page.getByRole('heading', { name: 'Create administrator' }).waitFor();
    disconnect();
    await page.reload();
    await page.getByRole('alert').filter({ hasText: 'Could not reach the server' }).waitFor();
    assert.equal(await page.locator('.shell').count(), 0);
    await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
});

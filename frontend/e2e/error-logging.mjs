import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { FixtureScope } from '../../scripts/dev-caddy/fixture-scope.mjs';
import { startTestStack } from '../../scripts/dev-caddy/test-stack.mjs';

const root = resolve(import.meta.dirname, '../..');
let scope;
let stack;
let vite;
let browser;
let context;
let page;
let origin;
const pageErrors = [];
const browserRequests = [];
const invalid = ':80 {\n  integration_browser_bad_directive\n}\n';
const options = { timeout: 45000 };

before(async t => {
    scope = new FixtureScope(t.signal);
    stack = await scope.acquire(() => startTestStack({ signal: scope.signal }), stack => stack.close());
    await scope.run(() => promisify(execFile)(process.execPath, ['frontend/scripts/fetch-caddyfile-mode.mjs'], { cwd: root, timeout: 30000, signal: scope.signal }));
    vite = await scope.acquire(() => createServer({
        root: resolve(root, 'frontend'),
        cacheDir: resolve(stack.directory, 'vite-cache'),
        server: { host: '127.0.0.1', port: 0, proxy: { '/api': stack.url } },
    }), vite => vite.close());
    await scope.run(() => vite.listen());
    origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
    browser = await scope.acquire(() => chromium.launch({
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    }), browser => browser.close());
    context = await scope.acquire(() => browser.newContext({ viewport: { width: 1440, height: 900 } }), context => context.close());
    page = await scope.run(() => context.newPage());
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => browserRequests.push({ url: request.url() }));
    page.on('response', response => browserRequests.push({ url: response.url(), status: response.status() }));
    page.on('requestfailed', request => browserRequests.push({ url: request.url(), failure: request.failure() }));
    page.on('console', message => { if (message.type() === 'error') browserRequests.push({ error: message.text() }); });
    // New Docker interfaces can briefly invalidate Chromium's network state.
    // Retry only that startup transport error, never a failing test assertion.
    for (let attempt = 0; attempt < 3; attempt++) {
        const start = browserRequests.length;
        try {
            await page.goto(origin + '/dashboard');
            await waitForView('.shell');
            break;
        } catch (error) {
            const networkChanged = browserRequests.slice(start).some(entry => entry.failure?.errorText === 'net::ERR_NETWORK_CHANGED');
            if (!networkChanged || attempt === 2) throw error;
        }
    }
}, { timeout: 180000 });

after(() => scope?.close());

const go = path => page.goto(origin + path);
async function waitForView(selector, timeout = 10000) {
    try {
        await page.locator(selector).waitFor({ timeout });
    } catch (error) {
        const body = await page.locator('body').innerText();
        const logs = await stack.api('/logs/app');
        throw new Error(`${selector} did not become ready at ${page.url()}\n${body}\n${JSON.stringify(browserRequests.slice(-40))}\n${JSON.stringify(logs.data.entries.slice(-30))}`, { cause: error });
    }
}
const waitForEditor = () => waitForView('.cm-editor');
async function edit(text) {
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(text);
}
async function validate() {
    const response = page.waitForResponse(response => response.url().includes('/api/caddyfile/validations'));
    await page.getByRole('button', { name: /Validate/ }).click();
    return (await response).json();
}

test('localized action errors link to matching diagnostics and repeated actions remain visible', options, async () => {
    await go('/caddyfile');
    await waitForEditor();
    await edit(invalid);
    const first = await validate();
    const second = await validate();
    await page.waitForFunction(() => document.querySelectorAll('.toast-error').length === 2);
    const toasts = await page.locator('.toast-error').allTextContents();
    assert(toasts.every(text => text.includes('Validation failed. Check the configuration and application logs.')));
    assert(toasts.every(text => !text.includes('integration_browser_bad_directive')));
    assert.notEqual(first.requestId, second.requestId);
    await page.locator('.toast-error a').last().click();
    assert.equal(new URL(page.url()).searchParams.get('dist'), 'app');
    assert.equal(new URL(page.url()).searchParams.get('search'), second.requestId);
    await page.waitForFunction(id => document.querySelector('.log-wrap')?.textContent.includes(id), second.requestId);
    assert((await page.locator('.log-wrap').textContent()).includes('integration_browser_bad_directive'));
});

test('application log streams deliver new correlated errors', options, async () => {
    await go('/logs?dist=app');
    await page.locator('.log-line').first().waitFor();
    let streaming = false;
    const connected = page.waitForResponse(response => response.url().includes('/api/logs/app/stream'))
        .then(response => { streaming = true; return response; });
    await page.getByRole('button', { name: /Live/ }).click();
    // Proxies can buffer SSE headers until the first event. Generate bounded,
    // harmless traffic before asserting readiness, then emit the target error.
    const [response] = await Promise.all([connected, (async () => {
        for (let attempt = 0; attempt < 30 && !streaming; attempt++) {
            await stack.api('/version');
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    })()]);
    assert.equal(response.status(), 200);
    const adminUrl = stack.instances.get('alpha').instance.adminUrl + '/nonexistent-test-path';
    const failure = await stack.api('/instances/servers?adminUrl=' + encodeURIComponent(adminUrl));
    assert.equal(failure.data.code, 'INSTANCE_CONNECTION_FAILED');
    await page.locator('.search-input').fill(failure.requestId);
    await page.waitForFunction(id => document.querySelector('.log-wrap')?.textContent.includes(id), failure.requestId);
    await page.getByRole('button', { name: /Stop/ }).click();
});

test('Caddy log streams deliver real HTTP errors', options, async () => {
    await go('/logs?dist=caddy');
    await page.locator('.logs-page').waitFor();
    const connected = page.waitForResponse(response => response.url().includes('/api/logs/stream'));
    await page.getByRole('button', { name: /Live/ }).click();
    for (let attempt = 0; attempt < 30; attempt++) {
        const processes = await stack.harness.run(['exec', stack.harness.resource('alpha'), 'ps']);
        if (/tail .* -f/.test(processes)) break;
        assert(attempt < 29, 'Caddy tail process did not start');
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    const marker = 'browser-live-' + Date.now();
    await page.locator('.search-input').fill(marker);
    assert.equal((await fetch(stack.instances.get('alpha').httpUrl + '/error?case=' + marker)).status, 503);
    assert.equal((await connected).status(), 200);
    await page.waitForFunction(marker => document.querySelector('.log-wrap')?.textContent.includes(marker), marker);
    await page.getByRole('button', { name: /Stop/ }).click();
});

test('state errors deduplicate and recovery rearms them', options, async () => {
    const configPath = stack.instances.get('alpha').instance.configPath;
    const badPath = '/data/dev-caddy/missing-browser.Caddyfile';
    const changePath = path => stack.api('/instances/default', { method: 'PUT', body: { configPath: path } });
    await changePath(badPath);
    try {
        await go('/caddyfile');
        await page.locator('.toast-error').waitFor();
        await page.evaluate(() => {
            window.seenNotifications = 0;
            const seen = new WeakSet();
            const count = () => document.querySelectorAll('.toast-error').forEach(node => {
                if (!seen.has(node)) { seen.add(node); window.seenNotifications++; }
            });
            count();
            new MutationObserver(count).observe(document.querySelector('.toast-wrap'), { childList: true, subtree: true });
        });
        await page.locator('.toast-error a').click();
        await page.locator('.logs-page').waitFor();
        await page.locator('.nav-item').filter({ hasText: 'Caddyfile' }).click();
        await page.locator('.cm-editor').waitFor();
        assert.equal(await page.evaluate(() => window.seenNotifications), 1);
        await changePath(configPath);
        await page.locator('.nav-item').filter({ hasText: 'Logs' }).click();
        await page.locator('.nav-item').filter({ hasText: 'Caddyfile' }).click();
        await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('alpha'));
        assert.equal(await page.locator('.toast-error').count(), 0);
        await page.locator('.nav-item').filter({ hasText: 'Logs' }).click();
        await page.locator('.logs-page').waitFor();
        await changePath(badPath);
        await page.locator('.nav-item').filter({ hasText: 'Caddyfile' }).click();
        await page.locator('.toast-error').waitFor();
        assert.equal(await page.evaluate(() => window.seenNotifications), 2);
    } finally { await changePath(configPath); }
});

test('permission failures show localized feedback while keeping the active view', options, async () => {
    const endpoint = '**/api/caddyfile/validations*';
    await go('/caddyfile');
    await waitForEditor();
    await page.route(endpoint, route => route.fulfill({
        status: 403, contentType: 'application/json',
        body: JSON.stringify({ code: 'FORBIDDEN', error: 'private permission detail', requestId: 'permission-diagnostic' }),
    }));
    try {
        await validate();
        const toast = page.locator('.toast-error');
        await toast.waitFor();
        const text = await toast.textContent();
        assert(text.includes('You do not have permission to perform this operation.'));
        assert(!text.includes('private permission detail'));
        assert(!text.includes('Your session has expired'));
        assert.equal(await page.locator('.cm-editor').count(), 1);
        assert.equal(new URL(await toast.locator('a').getAttribute('href'), origin).searchParams.get('search'), 'permission-diagnostic');
    } finally { await page.unroute(endpoint); }
});

test('browser network loss has localized feedback without a server log link', options, async () => {
    await go('/caddyfile');
    await page.locator('.cm-editor').waitFor();
    await context.setOffline(true);
    try {
        await page.getByRole('button', { name: /Validate/ }).click();
        const toast = page.locator('.toast-error');
        await toast.waitFor();
        assert((await toast.textContent()).includes('Cannot reach the server. Check your connection.'));
        assert((await toast.textContent()).includes('NETWORK_ERROR'));
        assert.equal(await toast.locator('a').count(), 0);
    } finally { await context.setOffline(false); }
});

test('phone layout and incomplete locale fallback retain diagnostic links', options, async () => {
    await go('/caddyfile');
    await waitForEditor();
    await page.getByRole('combobox', { name: 'Choose language' }).selectOption('de');
    await page.setViewportSize({ width: 390, height: 844 });
    await edit(invalid);
    const failure = await validate();
    await page.locator('.toast-error a').last().waitFor();
    assert((await page.locator('.toast-error').last().textContent()).includes('Validation failed.'));
    await page.locator('.toast-error a').last().click();
    await page.waitForFunction(id => document.querySelector('.log-wrap')?.textContent.includes(id), failure.requestId);
});

test('application logs remain accessible without registered Caddy instances', options, async () => {
    assert.equal((await stack.api('/instances/default', { method: 'DELETE' })).status, 200);
    assert.equal((await stack.api('/caddyfile')).data.code, 'NO_INSTANCES');
    assert.equal((await stack.api('/logs/app')).status, 200);
    await go('/logs?dist=caddy');
    await page.waitForFunction(() => document.querySelector('.logs-page .btn-row button')?.disabled === true);
    await page.locator('.log-line').first().waitFor();
    assert.equal(await page.locator('.toast-error').count(), 0);
});

test('no uncaught browser JavaScript errors', () => assert.deepEqual(pageErrors, []));

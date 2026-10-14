import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import de from '../src/i18n/locales/de.js';
import en from '../src/i18n/locales/en.js';
import { prepareBrowserTests, useBrowserFixture } from './fixture.mjs';

const invalid = ':80 {\n  integration_browser_bad_directive\n}\n';
const options = { timeout: 120000 };

before(prepareBrowserTests, { timeout: 35000 });

// Keep UI actions next to their assertions; service lifecycle lives in fixture.mjs.
async function scenario(t) {
    const fixture = await useBrowserFixture(t);
    const { page, origin, waitForView } = fixture;
    return {
        ...fixture,
        go: path => page.goto(origin + path),
        waitForEditor: () => waitForView('.cm-editor'),
        async edit(text) {
            await page.locator('.cm-content').click();
            await page.keyboard.press('ControlOrMeta+a');
            await page.keyboard.insertText(text);
        },
        async validate() {
            const pending = page.waitForResponse(r =>
                r.url().includes('/api/caddyfile/validations') && r.request().method() === 'POST');
            await page.getByRole('button', { name: /Validate/ }).click();
            const response = await pending;
            const body = await response.json();
            body.requestId ??= await response.headerValue('X-Request-ID');
            return body;
        },
    };
}

test('localized action errors link to matching diagnostics and repeated actions remain visible', options, async t => {
    const { page, go, waitForEditor, edit, validate } = await scenario(t);
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

test('application log streams deliver new correlated errors', options, async t => {
    const { page, stack, go } = await scenario(t);
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

test('Caddy log streams deliver real HTTP errors', options, async t => {
    const { page, stack, go } = await scenario(t);
    const initialLogs = page.waitForResponse(response => new URL(response.url()).pathname === '/api/logs'
        && response.request().method() === 'GET');
    await go('/logs?dist=caddy');
    const snapshot = await initialLogs;
    assert.equal(snapshot.status(), 200);
    await snapshot.finished();
    await page.locator('.log-line').first().waitFor();
    const connected = page.waitForResponse(response => response.url().includes('/api/logs/stream'));
    await page.getByRole('button', { name: /Live/ }).click();
    // Establish browser delivery after the snapshot, rather than relying on a
    // tail process existing or SSE headers arriving before it starts reading.
    const readyMarker = 'browser-stream-ready-' + Date.now();
    let streaming = false;
    const delivered = page.waitForFunction(marker => document.querySelector('.log-wrap')?.textContent.includes(marker), readyMarker)
        .then(() => { streaming = true; });
    await Promise.all([delivered, (async () => {
        for (let attempt = 0; attempt < 30 && !streaming; attempt++) {
            await fetch(stack.instances.get('alpha').httpUrl + '/health?case=' + readyMarker, { signal: AbortSignal.timeout(1000) });
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    })()]);
    assert.equal((await connected).status(), 200);
    const marker = 'browser-live-' + Date.now();
    await page.locator('.search-input').fill(marker);
    assert.equal((await fetch(stack.instances.get('alpha').httpUrl + '/error?case=' + marker)).status, 503);
    await page.waitForFunction(marker => document.querySelector('.log-wrap')?.textContent.includes(marker), marker);
    await page.getByRole('button', { name: /Stop/ }).click();
});

test('state errors deduplicate and recovery rearms them', options, async t => {
    const { page, stack, go } = await scenario(t);
    const configPath = stack.instances.get('alpha').instance.configPath;
    const badPath = '/data/dev-caddy/missing-browser.Caddyfile';
    const changePath = path => stack.api('/instances/default', { method: 'PUT', body: { configPath: path } });
    await changePath(badPath);
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
});

test('permission failures show localized feedback while keeping the active view', options, async t => {
    const { page, origin, go, waitForEditor, validate } = await scenario(t);
    const endpoint = '**/api/caddyfile/validations*';
    await go('/caddyfile');
    await waitForEditor();
    await page.route(endpoint, route => route.fulfill({
        status: 403, contentType: 'application/json',
        body: JSON.stringify({ code: 'FORBIDDEN', error: 'private permission detail', requestId: 'permission-diagnostic' }),
    }));
    await validate();
    const toast = page.locator('.toast-error');
    await toast.waitFor();
    const text = await toast.textContent();
    assert(text.includes('You do not have permission to perform this operation.'));
    assert(!text.includes('private permission detail'));
    assert(!text.includes('Your session has expired'));
    assert.equal(await page.locator('.cm-editor').count(), 1);
    assert.equal(new URL(await toast.locator('a').getAttribute('href'), origin).searchParams.get('search'), 'permission-diagnostic');
});

test('browser network loss has localized feedback without a server log link', options, async t => {
    const { page, context, go } = await scenario(t);
    await go('/caddyfile');
    await page.locator('.cm-editor').waitFor();
    await context.setOffline(true);
    await page.getByRole('button', { name: /Validate/ }).click();
    const toast = page.locator('.toast-error');
    await toast.waitFor();
    assert((await toast.textContent()).includes('Cannot reach the server. Check your connection.'));
    assert((await toast.textContent()).includes('NETWORK_ERROR'));
    assert.equal(await toast.locator('a').count(), 0);
});

test('phone layout and incomplete locale fallback retain diagnostic links', options, async t => {
    const { page, go, waitForEditor, edit, validate } = await scenario(t);
    await go('/caddyfile');
    await waitForEditor();
    await page.getByRole('combobox', { name: 'Choose language' }).selectOption('de');
    const locale = await page.evaluateHandle(async () => (await import('/src/i18n/index.js')).default);
    try {
        await page.waitForFunction(({ i18n, sentinel }) => i18n.language === 'de'
            && i18n.hasResourceBundle('de', 'translation') && i18n.t('test.languageLoaded') === sentinel
            && i18n.getResource('de', 'translation', 'errors.validationFailed') === undefined,
            { i18n: locale, sentinel: de.test.languageLoaded });
    } finally { await locale.dispose(); }
    await page.setViewportSize({ width: 390, height: 844 });
    await edit(invalid);
    const failure = await validate();
    await page.locator('.toast-error a').last().waitFor();
    assert((await page.locator('.toast-error').last().textContent()).includes(en.errors.validationFailed));
    await page.locator('.toast-error a').last().click();
    await page.waitForFunction(id => document.querySelector('.log-wrap')?.textContent.includes(id), failure.requestId);
});

test('application logs remain accessible without registered Caddy instances', options, async t => {
    const { page, stack, go } = await scenario(t);
    assert.equal((await stack.api('/instances/default', { method: 'DELETE' })).status, 200);
    assert.equal((await stack.api('/caddyfile')).data.code, 'NO_INSTANCES');
    assert.equal((await stack.api('/logs/app')).status, 200);
    await go('/logs?dist=caddy');
    await page.waitForFunction(() => document.querySelector('.logs-page .btn-row button')?.disabled === true);
    await page.locator('.log-line').first().waitFor();
    assert.equal(await page.locator('.toast-error').count(), 0);
});

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import de from '../../src/frontend/src/i18n/locales/de.js';
import en from '../../src/frontend/src/i18n/locales/en.js';
import { prepareBrowserTests, useBrowserFixture } from './fixture.mjs';

const invalid = ':80 {\n  integration_browser_bad_directive\n}\n';
const options = { timeout: 120000 };

before(prepareBrowserTests, { timeout: 35000 });

test('unreadable logging configuration has a useful coded error and recovers after correction', options, async t => {
    const { page, stack, origin } = await useBrowserFixture(t);
    const { instance } = stack.instances.get('alpha');
    const original = (await stack.api('/caddyfile')).data;
    const writeConfig = text => stack.harness.run(['exec', instance.containerName, 'sh', '-c',
        'printf "%s" "$1" > "$2"', 'sh', text, instance.configPath]);
    await writeConfig('{\nlog {\n');
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/logs/config');
    await page.goto(origin + '/logs?dist=caddy', { waitUntil: 'domcontentloaded' });
    const response = await pending;
    assert.equal(response.status(), 500);
    const failure = await response.json();
    assert.equal(failure.code, 'LOG_CONFIG_PARSE_FAILED');
    assert.ok(failure.requestId);
    await page.locator('.card-header--clickable').filter({ hasText: en.logs.configuration }).click();
    const alert = page.locator('.card-body[role="alert"]');
    await alert.waitFor();
    assert.equal(await alert.textContent(), en.errors.logConfigParseFailed);
    assert(!(await page.locator('body').textContent()).includes('Unclosed Caddyfile block'));
    await writeConfig(original);
    await page.getByRole('button', { name: 'caddy/ui', exact: true }).click();
    const corrected = page.waitForResponse(response => new URL(response.url()).pathname === '/api/logs/config');
    await page.getByRole('button', { name: en.logs.caddySource, exact: true }).click();
    assert.equal((await corrected).status(), 200);
    await page.locator('.config-grid').waitFor();
    assert.equal(await alert.count(), 0);
});

// Keep UI actions next to their assertions; service lifecycle lives in fixture.mjs.
async function scenario(t) {
    const fixture = await useBrowserFixture(t);
    const { page, origin, waitForView } = fixture;
    return {
        ...fixture,
        // A transient toast can expire while an unrelated stylesheet delays load.
        // Each scenario waits for the component/notification it actually needs.
        go: path => page.goto(origin + path, { waitUntil: 'domcontentloaded' }),
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

test('Caddy logs distinguish failed reads from empty files and recover after refresh', options, async t => {
    const { page, stack, go } = await scenario(t);
    const { instance } = stack.instances.get('alpha');
    const changePath = logPath => stack.api('/instances/default', { method: 'PUT', body: { logPath } });
    const refresh = async () => {
        const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/logs');
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        return pending;
    };
    await page.addInitScript(() => {
        const NativeEventSource = window.EventSource;
        window.logTestStreams = [];
        window.EventSource = class extends NativeEventSource {
            constructor(...args) { super(...args); window.logTestStreams.push(this); }
        };
    });
    await changePath('/data/dev-caddy/logs/not-created.log');
    const initial = page.waitForResponse(response => new URL(response.url()).pathname === '/api/logs');
    await go('/logs?dist=caddy');
    assert.equal((await initial).status(), 404);
    const alert = page.locator('.log-wrap [role="alert"]');
    await alert.waitFor();
    assert.equal(await alert.textContent(), en.errors.logFileMissing);
    assert.equal(await page.locator('.log-line-count--desktop').textContent(), en.logs.unavailable);
    assert.equal((await refresh()).status(), 404);
    assert.equal(await page.locator('.toast-error').count(), 1, 'Repeated snapshot failures deduplicate');

    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await page.waitForFunction(() => window.logTestStreams.at(-1)?.readyState === EventSource.CLOSED);
    await page.getByRole('button', { name: 'Live', exact: true }).waitFor();
    assert.equal(await alert.textContent(), en.errors.logFileMissing, 'Missing-file SSE errors are visible');

    await changePath('/data/dev-caddy/logs');
    const failed = await refresh();
    assert.equal(failed.status(), 500);
    const failure = await failed.json();
    assert.equal(failure.code, 'LOG_READ_FAILED');
    await page.waitForFunction(message => document.querySelector('.log-wrap [role="alert"]')?.textContent === message, en.errors.logReadFailed);
    const diagnostics = (await stack.api('/logs/app')).data.entries.find(entry => entry.requestId === failure.requestId && entry.causes);
    assert.equal(diagnostics.causes[0].context.logPath, '/data/dev-caddy/logs');
    assert.match(diagnostics.causes[1].message, /directory/i);

    await changePath(instance.logPath);
    assert.equal((await refresh()).status(), 200);
    await page.locator('.log-line').first().waitFor();
    assert.equal(await alert.count(), 0, 'Successful refresh clears the failed-read state');
    await stack.harness.run(['exec', instance.containerName, 'touch', '/data/dev-caddy/logs/empty.log']);
    await changePath('/data/dev-caddy/logs/empty.log');
    const empty = await refresh();
    assert.equal(empty.status(), 200);
    assert.deepEqual((await empty.json()).lines, []);
    await page.waitForFunction(message => document.querySelector('.log-wrap')?.textContent === message, en.logs.noLinesLoaded);
    assert.equal(await alert.count(), 0);
    assert.equal(await page.locator('.log-line-count--desktop').textContent(), '0 lines');
});

test('Caddy logs surface legacy HTTP 200 read errors without exposing raw server details', options, async t => {
    const { page, go } = await scenario(t);
    const endpoint = '**/api/logs';
    await page.route(endpoint, route => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ lines: [], error: 'private legacy container failure' }),
    }));
    await go('/logs?dist=caddy');
    const alert = page.locator('.log-wrap [role="alert"]');
    await alert.waitFor();
    assert.equal(await alert.textContent(), en.errors.logReadFailed);
    assert.equal(await page.locator('.log-line-count--desktop').textContent(), en.logs.unavailable);
    assert(!(await page.locator('body').textContent()).includes('private legacy container failure'));
    await page.unroute(endpoint);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.locator('.log-line').first().waitFor();
    assert.equal(await alert.count(), 0);
});

test('Caddy live logs report refused streams and keep loaded lines', options, async t => {
    const { page, go } = await scenario(t);
    await page.route('**/api/logs/stream', route => route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ code: 'LOG_SOURCE_UNAVAILABLE', error: 'Operation failed' }),
    }));
    await go('/logs?dist=caddy');
    await page.locator('.log-line').first().waitFor();
    const lineCount = await page.locator('.log-line-count--desktop').textContent();
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    const alert = page.locator('.log-wrap [role="alert"]');
    await alert.waitFor();
    assert.equal(await alert.textContent(), en.errors.logStreamError, 'A refused EventSource stops Live mode visibly');
    await page.getByRole('button', { name: 'Live', exact: true }).waitFor();
    assert.equal(await page.locator('.log-line-count--desktop').textContent(), lineCount, 'Loaded lines keep their count');
    assert.ok(await page.locator('.log-line').count() > 0);
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

test('transient state errors are observable while an unrelated stylesheet is pending', options, async t => {
    const { page, stack, go } = await scenario(t);
    let release;
    let stylesheetPending = false;
    const stylesheet = new Promise(resolve => { release = resolve; });
    await page.route('**/__e2e_pending_style.css', async route => {
        stylesheetPending = true;
        await stylesheet;
        await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
        stylesheetPending = false;
    });
    await page.addInitScript(() => {
        addEventListener('DOMContentLoaded', () => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/__e2e_pending_style.css';
            document.head.append(link);
        });
    });
    try {
        assert.equal((await stack.api('/instances/default', { method: 'PUT',
            body: { configPath: '/data/dev-caddy/missing-stylesheet.Caddyfile' } })).status, 200);
        await go('/caddyfile');
        const toast = page.locator('.toast-error');
        await toast.waitFor();
        assert((await toast.textContent()).includes(en.errors.caddyfileReadFailed));
        assert.equal(stylesheetPending, true, 'The stylesheet must still be blocking full document load');
        assert.notEqual(await page.evaluate(() => document.readyState), 'complete');
    } finally {
        // Release the resource even if navigation/assertions fail. The existing
        // fixture then tears down the real backend, browser and owned container.
        release();
        await page.unrouteAll({ behavior: 'wait' });
    }
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
    // Deliberately sparse fixture: completing the real German catalog must not
    // remove this scenario's missing-key fallback coverage.
    await page.route('**/src/i18n/locales/de.js*', route => route.fulfill({
        contentType: 'application/javascript',
        body: `export default ${JSON.stringify({ test: de.test })};`,
    }));
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

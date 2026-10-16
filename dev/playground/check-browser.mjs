import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { THEME_LIST } from '../../src/frontend/src/styles.js';
import en from '../../src/frontend/src/i18n/locales/en.js';
import { flattenCatalog, readValue } from './model.js';

// Optional development check: no backend, Docker, or CI browser job is needed.
const vite = await createServer({ configFile: fileURLToPath(new URL('vite.config.js', import.meta.url)),
    server: { host: '127.0.0.1', port: 0, strictPort: false } });
let browser;
try {
    await vite.listen();
    const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
    browser = await chromium.launch({
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
    const frame = () => page.frameLocator('iframe');
    async function go(key, state, locale = 'en') {
        await page.goto(`${origin}/?${new URLSearchParams({ key, state, locale })}`);
        await frame().locator(`[data-preview-key="${key}"]`).first().waitFor();
        await page.locator('.preview-context').getByText(/DOM references for/).waitFor();
        // A rebase may invalidate capture provenance without changing replay behavior.
        assert.equal(await page.getByRole('alert').filter({ hasNotText: 'Captured data differs' }).count(), 0);
    }
    const editor = page.getByLabel('Try translation');
    await go('dashboard.status', 'dashboard-online');
    assert.equal(await frame().locator('[data-preview-key="dashboard.status"]').count(), 2);
    assert.ok((await frame().locator('body').innerText()).includes('Playground HTTP'));
    assert.equal(await page.locator('nav[aria-label="Translation keys"] button').count(), flattenCatalog(en).length);
    await editor.fill('Preview status');
    await page.waitForFunction(() => [...document.querySelector('iframe').contentDocument.querySelectorAll('[data-preview-key="dashboard.status"]')]
        .every(element => element.textContent === 'Preview status'));
    await editor.fill(en.dashboard.online);
    await page.getByText('Dashed highlights indicate wording shared with other keys;', { exact: false }).waitFor();
    assert.ok(await frame().locator('[data-preview-ambiguous]').count() > 0);
    await editor.fill('Preview status');
    await page.getByRole('combobox').first().selectOption('de');
    assert.equal(await editor.inputValue(), 'Status');
    await page.getByRole('combobox').first().selectOption('en');
    assert.equal(await editor.inputValue(), 'Preview status');
    await page.getByRole('button', { name: 'Reset this key' }).click();
    assert.equal(await editor.inputValue(), 'Status');
    await page.getByRole('button', { name: 'Copy preview link' }).click();
    const link = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    assert.equal(link.searchParams.get('key'), 'dashboard.status');
    assert.equal(link.searchParams.get('state'), 'dashboard-online');
    await go('dashboard.offline', 'dashboard-stopped');
    assert.equal(await frame().locator('tbody tr').count(), 0);
    assert.ok((await frame().locator('body').innerText()).includes('Caddy status unavailable'));
    await go('dashboard.status', 'dashboard-empty');
    assert.equal(await frame().locator('tbody tr').count(), 0);
    await go('dashboard.serverIdHint', 'dashboard-online');
    assert.equal(await frame().locator('th[data-preview-key]').count(), 1);
    await go('dashboard.systemMemory', 'dashboard-online', 'de');
    const memory = await frame().locator('[data-preview-key]').innerText();
    assert.match(memory, /\d+,\d+/);
    await page.locator('.preview-context summary').click();
    assert.ok((await page.locator('.preview-context pre').innerText()).includes('"value"'));
    await go('dashboard.labelHint', 'dashboard-edit-label');
    assert.equal(await frame().locator('.modal-hint[data-preview-key]').count(), 1);
    await go('dashboard.labelPlaceholder', 'dashboard-edit-label');
    assert.equal(await frame().locator('input[data-preview-key]').count(), 1);
    await page.evaluate(() => localStorage.setItem('caddy_ui_token', 'parent-session-sentinel'));
    assert.equal(await frame().locator('body').evaluate(() => localStorage.getItem('caddy_ui_token')), null);
    await frame().locator('.modal input').fill('Unrecorded label');
    await frame().getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /Unrecorded request: PUT/ }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('caddy_ui_token')), 'parent-session-sentinel');
    await go('dashboard.labelSaved', 'dashboard-label-saved');
    await editor.fill('');
    await editor.pressSequentially('Preview saved', { delay: 80 });
    assert.equal(await editor.inputValue(), 'Preview saved');
    await frame().locator('.toast-success[data-preview-key]').filter({ hasText: 'Preview saved' }).waitFor();
    await page.reload();
    await frame().locator('.toast-success[data-preview-key]').waitFor();
    assert.notEqual(await editor.inputValue(), 'Preview saved');
    await go('common.delete', 'route-delete');
    await editor.fill('Preview delete');
    await frame().getByRole('button', { name: 'Preview delete', exact: true }).waitFor();
    await go('tls.deleteConfirm', 'certificate-delete');
    await page.locator('.preview-context summary').click();
    assert.ok((await page.locator('.preview-context pre').innerText()).includes('example.home.arpa'));
    await editor.fill('Preview {{domain}}');
    await page.getByRole('alert').filter({ hasText: /Interpolation placeholders differ/ }).waitFor();
    await frame().locator('[data-preview-key]').filter({ hasText: 'Preview example.home.arpa' }).waitFor();
    await go('notifications.saved', 'notification-saved');
    await editor.fill('Preview notification');
    await frame().locator('.toast-success').filter({ hasText: 'Preview notification' }).waitFor();
    await page.getByRole('button', { name: 'Light previews' }).click();
    const surface = THEME_LIST.find(theme => theme.id === 'coarse-everywhere').vars['--surface'];
    await page.waitForFunction(surface => getComputedStyle(document.querySelector('iframe').contentDocument.documentElement).getPropertyValue('--surface').trim() === surface, surface);
    await page.evaluate(async () => { const { capture } = await import('/registry.jsx'); capture.source.sourceHash = '0'.repeat(64); });
    await page.getByRole('button', { name: 'Dark previews' }).click();
    await page.getByRole('alert').filter({ hasText: /Captured data differs/ }).waitFor();
    await go('common.loading', 'dashboard-loading');
    // Walk every added registration in the real production DOM. No replacement
    // API contract is needed for prop-driven onboarding and appearance controls.
    const additions = await page.evaluate(async () => {
        const { scenarios } = await import('/registry.jsx');
        return scenarios.filter(scenario => ['login', 'theme-welcome', 'appearance-controls'].includes(scenario.kind));
    });
    assert.equal(new Set(additions.flatMap(scenario => scenario.keys)).size, 27);
    for (const scenario of additions) {
        await go(scenario.keys[0], scenario.id);
        for (const key of scenario.keys) {
            await page.getByRole('navigation', { name: 'Translation keys' }).getByRole('button', { name: key, exact: true }).click();
            const reference = frame().locator(`[data-preview-key="${key}"]`).first();
            await reference.waitFor();
            await editor.fill(`${readValue(en, key)} [preview]`);
            await page.waitForFunction(key => {
                const elements = document.querySelector('iframe').contentDocument.querySelectorAll(`[data-preview-key="${key}"]`);
                return [...elements].some(element => [element.textContent, ...['title', 'aria-label', 'placeholder'].map(name => element.getAttribute(name))]
                    .some(value => value?.includes('[preview]')));
            }, key);
            await page.getByRole('button', { name: 'Reset this key' }).click();
            await reference.waitFor();
        }
    }
    await go('login.sessionExpired', 'login-session-expired');
    await editor.fill('Session expired preview');
    await frame().locator('.login-error').filter({ hasText: 'Session expired preview' }).waitFor();
    await page.getByRole('combobox').first().selectOption('de');
    await frame().locator('.login-error').filter({ hasText: en.login.sessionExpired }).waitFor();
    await page.getByRole('combobox').first().selectOption('en');
    await frame().locator('.login-error').filter({ hasText: 'Session expired preview' }).waitFor();
    const before = await page.locator('iframe').boundingBox();
    // Let multiple rendering/resize cycles pass: the viewport-height login shell
    // must not create a feedback loop that keeps enlarging its own iframe.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await page.locator('iframe').boundingBox();
    assert.equal(after.height, before.height);
    const card = await frame().locator('.login-card').boundingBox();
    assert.ok(card.y >= after.y && card.y + card.height <= after.y + after.height + 1);

    await go('themePicker.exportTitle', 'appearance-controls-dark');
    await page.locator('.preview-context summary').click();
    assert.match(await page.locator('.preview-context pre').innerText(), /"label": "VT2026"/);
    assert.match(await page.locator('.preview-context pre').innerText(), /"mode": "dark"/);
    await frame().locator('.theme-picker-menu select').first().selectOption('dracula');
    await page.waitForFunction(() => document.querySelector('iframe').contentDocument.querySelector('.theme-picker-export button').title.includes('Dracula'));
    const menu = await frame().locator('.theme-picker-menu').boundingBox();
    const preview = await page.locator('iframe').boundingBox();
    assert.ok(menu.y >= preview.y && menu.y + menu.height <= preview.y + preview.height + 1);
    const download = page.waitForEvent('download');
    await frame().locator('.theme-picker-export button').click();
    assert.equal((await download).suggestedFilename(), 'dracula.json');

    await go('login.signIn', 'login');
    await frame().locator('.field input').first().fill('preview-user');
    await frame().locator('.field input').last().fill('preview-password');
    await frame().getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded request: POST /api/auth/sessions' }).waitFor();
    await frame().locator('.login-error').filter({ hasText: en.login.serverUnreachable }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('caddy_ui_token')), 'parent-session-sentinel');

    const notificationStates = await page.evaluate(async () => {
        const { scenarios } = await import('/registry.jsx');
        return scenarios.filter(scenario => scenario.kind === 'notification-settings');
    });
    const notificationKeys = new Set();
    for (const scenario of notificationStates) {
        await go(scenario.keys[0], scenario.id);
        await page.waitForFunction(({ provider, enabled }) => {
            const doc = document.querySelector('iframe').contentDocument;
            return doc.querySelector('select.config-select')?.value === provider &&
                doc.querySelector('.notifications-enabled-btn')?.classList.contains('btn-danger') === Boolean(enabled);
        }, scenario);
        for (const key of scenario.keys.filter(key => !notificationKeys.has(key))) {
            await page.getByRole('navigation', { name: 'Translation keys' }).getByRole('button', { name: key, exact: true }).click();
            await frame().locator(`[data-preview-key="${key}"]`).first().waitFor();
            await editor.fill(`${readValue(en, key)} [preview]`);
            await page.waitForFunction(key => {
                const elements = document.querySelector('iframe').contentDocument.querySelectorAll(`[data-preview-key="${key}"]`);
                return [...elements].some(element => [element.textContent, element.getAttribute('placeholder')]
                    .some(value => value?.includes('[preview]')));
            }, key);
            await page.getByRole('button', { name: 'Reset this key' }).click();
            notificationKeys.add(key);
        }
    }
    assert.equal(notificationKeys.size, 30);
    await go('notifications.jsonSchemaHint', 'notifications-custom');
    await frame().locator('input[type="url"]').fill('https://preview.invalid/notify');
    await page.getByRole('navigation', { name: 'Translation keys' }).getByRole('button', { name: 'notifications.httpMethod', exact: true }).click();
    assert.equal(await frame().locator('input[type="url"]').inputValue(), 'https://preview.invalid/notify');
    await frame().locator('select.config-select').last().selectOption('PUT');
    const lastField = await frame().locator('input[type="number"]').boundingBox();
    const notificationFrame = await page.locator('iframe').boundingBox();
    assert.ok(lastField.y + lastField.height <= notificationFrame.y + notificationFrame.height + 1);
    await frame().getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded request: PUT /api/notifications/config' }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('caddy_ui_token')), 'parent-session-sentinel');
    await go('notifications.disable', 'notifications-enabled');
    await frame().getByRole('button', { name: 'Test notification', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded request: POST /api/notifications/test' }).waitFor();
    await go('notifications.enable', 'notifications-ntfy');
    assert.equal(await frame().getByRole('button', { name: 'Test notification', exact: true }).isDisabled(), true);

    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1280, height: 600 }]) {
        await page.setViewportSize(viewport);
        await go('tls.deleteConfirm', 'certificate-delete');
        await page.locator('.preview-context summary').click();
        const detail = page.getByRole('region', { name: 'Translation details' });
        const bounds = await detail.boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1);
        assert.equal(await detail.evaluate(element => getComputedStyle(element).overflowY), 'auto');
        if (viewport.height <= 768) {
            assert.ok(await detail.evaluate(element => element.scrollHeight > element.clientHeight));
            await detail.focus();
            await page.keyboard.press('End');
            await page.waitForFunction(() => document.querySelector('.detail').scrollTop > 0);
            const reset = page.getByRole('button', { name: 'Reset this key' });
            await reset.click();
            const button = await reset.boundingBox();
            assert.ok(button.y >= bounds.y && button.y + button.height <= viewport.height);
            await detail.evaluate(element => { element.scrollTop = 0; });
            await page.mouse.move(bounds.x + bounds.width - 30, bounds.y + 20);
            await page.mouse.wheel(0, 500);
            await page.waitForFunction(() => document.querySelector('.detail').scrollTop > 0);
        }
        const keys = page.getByRole('navigation', { name: 'Translation keys' });
        await keys.locator('button').last().scrollIntoViewIfNeeded();
        const last = await keys.locator('button').last().boundingBox();
        assert.ok(last.y >= 0 && last.y + last.height <= viewport.height + 1);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Reset this key' }).click();
    const mobileButton = await page.getByRole('button', { name: 'Reset this key' }).boundingBox();
    assert.ok(mobileButton.y >= 0 && mobileButton.y + mobileButton.height <= 844);
    assert.ok(await page.locator('.workbench').evaluate(element => element.scrollTop > 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    console.log('Playground Chromium checks passed: real Dashboard states, 27 onboarding/appearance keys, 30 notification settings keys, live drafts, DOM context, interpolation, locale formatting, focus, offline isolation, blocked notification saves/sends, clipboard, reload, local theme export, bounded frame sizing, keyboard/wheel pane scrolling and mobile reachability.');
} finally {
    await browser?.close();
    await vite.close();
}

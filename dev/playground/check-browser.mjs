import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../browser.mjs';
import { createServer } from 'vite';
import { THEME_LIST } from '../../src/frontend/src/styles.js';
import en from '../../src/frontend/src/i18n/locales/en.js';
import de from '../../src/frontend/src/i18n/locales/de.js';
import { flattenCatalog, readValue } from './model.js';

// Optional development check: no backend, Docker, or CI browser job is needed.
const vite = await createServer({ configFile: fileURLToPath(new URL('vite.config.js', import.meta.url)),
    server: { host: '127.0.0.1', port: 0, strictPort: false } });
let browser;
try {
    await vite.listen();
    const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
    browser = await launchChromium();
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
        assert.equal(await page.getByRole('alert').count(), 0);
    }
    const editor = page.getByLabel('Try translation');
    const keyList = page.getByRole('navigation', { name: 'Translation keys' });
    // Every registered key of these kinds, in the real production DOM: it's shown,
    // follows the draft and follows the reset.
    async function walk(...kinds) {
        const registered = await page.evaluate(async () => (await import('/registry.jsx')).scenarios);
        const walked = new Set();
        for (const scenario of registered.filter(scenario => kinds.includes(scenario.kind))) {
            const keys = scenario.keys.filter(key => !walked.has(key));
            if (!keys.length) continue;
            await go(keys[0], scenario.id);
            for (const key of keys) {
                await keyList.getByRole('button', { name: key, exact: true }).click();
                await frame().locator(`[data-preview-key="${key}"]`).first().waitFor();
                const showsDraft = expected => page.waitForFunction(({ key, expected }) => {
                    const elements = [...document.querySelector('iframe').contentDocument.querySelectorAll(`[data-preview-key="${key}"]`)];
                    const shown = elements.some(element => [element.textContent, ...['title', 'aria-label', 'aria-valuetext', 'placeholder'].map(name => element.getAttribute(name))]
                        .some(value => value?.includes('[preview]')));
                    return elements.length && shown === expected;
                }, { key, expected });
                await editor.fill(`${readValue(en, key)} [preview]`);
                await showsDraft(true);
                await page.getByRole('button', { name: 'Reset this key' }).click();
                await showsDraft(false);
                walked.add(key);
            }
        }
    }
    await go('dashboard.status', 'dashboard-online');
    const previewFrame = page.frames().find(frame => frame !== page.mainFrame());
    assert.ok(previewFrame, 'Preview frame must be attached before checking bundled fonts');
    for (const target of [page.mainFrame(), previewFrame]) {
        assert.equal(await target.evaluate(async () => {
            const faces = await Promise.all(['IBM Plex Sans', 'IBM Plex Mono'].map(family => document.fonts.load(`400 12px "${family}"`)));
            return faces.every(fonts => fonts.length > 0 && fonts.every(font => font.status === 'loaded'));
        }), true, 'Workbench and preview frame must load their bundled fonts');
    }
    assert.equal(await frame().locator('[data-preview-key="dashboard.status"]').count(), 2);
    assert.ok((await frame().locator('body').innerText()).includes('Playground HTTP'));
    assert.equal(await page.locator('nav[aria-label="Translation keys"] button').count(), flattenCatalog(en).length);
    const registeredKeys = await page.evaluate(async () => {
        const { scenarios } = await import('/registry.jsx');
        return [...new Set(scenarios.flatMap(scenario => scenario.keys))];
    });
    assert.equal(await keyList.locator('.preview-indicator').count(), registeredKeys.length);
    const coveredKey = keyList.getByRole('button', { name: 'dashboard.status', exact: true });
    assert.equal(await coveredKey.locator('.preview-indicator[aria-hidden="true"]').count(), 1);
    assert.equal(await coveredKey.getAttribute('title'), 'Live preview available');
    assert.equal(await coveredKey.getAttribute('aria-describedby'), 'preview-legend');
    const uncovered = flattenCatalog(en).find(([key]) => !registeredKeys.includes(key))[0];
    assert.equal(await keyList.getByRole('button', { name: uncovered, exact: true }).locator('.preview-indicator').count(), 0);
    await page.getByLabel('Search keys and translations').fill('dashboard.status');
    assert.equal(await keyList.locator('button').count(), 1);
    assert.equal(await keyList.locator('.preview-indicator').count(), 1);
    await page.getByLabel('Search keys and translations').fill('');
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
    assert.ok((await frame().locator('body').innerText()).includes(en.errors.upstreamUnavailable));
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
    await page.getByRole('button', { name: 'Dark previews' }).click();
    await go('common.loading', 'dashboard-loading');
    await walk('login', 'theme-welcome', 'appearance-controls');
    await go('login.sessionExpired', 'login-session-expired');
    await editor.fill('Session expired preview');
    await frame().locator('.login-error').filter({ hasText: 'Session expired preview' }).waitFor();
    await page.getByRole('combobox').first().selectOption('de');
    await frame().locator('.login-error').filter({ hasText: de.login.sessionExpired }).waitFor();
    await page.getByRole('combobox').first().selectOption('en');
    await frame().locator('.login-error').filter({ hasText: 'Session expired preview' }).waitFor();
    const before = await page.locator('iframe').boundingBox();
    // Let multiple rendering/resize cycles pass: the viewport-height login shell
    // must not create a feedback loop that keeps enlarging its own iframe.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await page.locator('iframe').boundingBox();
    // It may still be settling to a smaller size
    assert.ok(after.height <= before.height);
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
    await frame().locator('.login-error').filter({ hasText: en.errors.network }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('caddy_ui_token')), 'parent-session-sentinel');

    await walk('notification-settings');
    await go('notifications.jsonSchemaHint', 'notifications-custom');
    await frame().locator('input[type="url"]').fill('https://preview.invalid/notify');
    await keyList.getByRole('button', { name: 'notifications.httpMethod', exact: true }).click();
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

    await walk('metrics', 'logs');
    await go('metrics.lastScraped', 'metrics-overview');
    await page.locator('.preview-context summary').click();
    assert.match(await page.locator('.preview-context pre').innerText(), /"time":/);
    await frame().locator('.metrics-toggle-btn').click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded request: PUT /api/metrics/config' }).waitFor();
    await go('common.off', 'metrics-overview');
    await frame().getByRole('button', { name: /Route checks:/ }).click();
    await frame().getByRole('button', { name: 'Route checks: On', exact: true }).waitFor();
    await go('logs.format', 'logs-configured');
    await frame().locator('.log-enabled-btn.btn-danger').waitFor();
    await frame().locator('.config-grid-full input').fill('/tmp/playground-only.log');
    await frame().locator('select.config-select').first().selectOption('console');
    await keyList.getByRole('button', { name: 'logs.level', exact: true }).click();
    assert.equal(await frame().locator('.config-grid-full input').inputValue(), '/tmp/playground-only.log');
    assert.equal(await frame().locator('select.config-select').first().inputValue(), 'console');
    await frame().locator('.log-save-btn').click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded request: PUT /api/logs/config' }).waitFor();
    await go('common.enable', 'logs-disabled');
    await frame().locator('.log-enabled-btn.btn-primary').waitFor();
    assert.equal(await frame().locator('.config-grid-full input').isDisabled(), true);
    assert.notEqual(await frame().locator('.config-grid-full input').inputValue(), '/tmp/playground-only.log');
    await go('logs.noMatchingLines', 'logs-filtered');
    await frame().getByTitle('Clear search', { exact: true }).click();
    await frame().locator('.log-line').first().waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('caddy_ui_token')), 'parent-session-sentinel');

    await walk('tls', 'sidebar');
    await go('tls.certificates', 'tls-expired');
    await frame().getByRole('button', { name: en.common.refresh, exact: true }).last().click();
    await frame().locator('.section-label').filter({ hasText: 'Certificates — expired' }).waitFor();
    await go('tls.downloadRootCa', 'tls-empty');
    await frame().getByRole('button', { name: en.tls.downloadRootCa, exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded window: /api/tls/ca' }).waitFor();
    await go('sidebar.versionDetails', 'sidebar-online');
    await page.locator('.preview-context summary').click();
    assert.match(await page.locator('.preview-context pre').innerText(), /"frontend": "dev"/);
    for (const state of ['sidebar-online', 'sidebar-stopped', 'sidebar-checking']) {
        await go('sidebar.nav.dashboard', state);
        const initialHeight = await page.locator('iframe').evaluate(element => element.getBoundingClientRect().height);
        await frame().locator('.nav-item').filter({ hasText: 'Routes' }).click();
        await frame().locator('.nav-item.active').filter({ hasText: 'Routes' }).waitFor();
        await page.waitForTimeout(150);
        assert.equal(await page.locator('iframe').evaluate(element => element.getBoundingClientRect().height), initialHeight);
        assert.equal(await page.evaluate(() => localStorage.getItem('caddy_ui_token')), 'parent-session-sentinel');
    }

    await walk('routes', 'route-history');
    await go('routes.newRoute', 'routes-add');
    await frame().locator('.modal input').nth(0).fill('preview.home.arpa');
    await frame().locator('.modal input').nth(1).fill('127.0.0.1:8080');
    await editor.fill(`${en.routes.newRoute} [preview]`);
    await frame().locator('.modal-title').filter({ hasText: '[preview]' }).waitFor();
    assert.equal(await frame().locator('.modal input').nth(0).inputValue(), 'preview.home.arpa');
    await frame().locator('.modal .btn-primary').click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded request: POST /api/routes' }).waitFor();
    await go('routes.someColumnsHidden', 'routes-columns');
    await frame().locator('.col-picker-badge').waitFor();
    assert.equal(await frame().locator('.col-picker-item input').last().isChecked(), false);
    await editor.fill(`${en.routes.someColumnsHidden} [preview]`);
    await frame().getByTitle(`${en.routes.someColumnsHidden} [preview]`, { exact: true }).waitFor();
    assert.equal(await frame().locator('.col-picker-item input').last().isChecked(), false);
    await go('routes.noMatching', 'routes-filtered');
    await page.locator('.preview-context summary').click();
    assert.match(await page.locator('.preview-context pre').innerText(), /"search": "playground-no-matching-routes"/);
    await frame().getByTitle('Clear filter', { exact: true }).click();
    await frame().locator('tbody tr').first().waitFor();
    await go('routeHistory.segmentTitle', 'route-history-empty');
    await page.locator('.preview-context summary').click();
    assert.match(await page.locator('.preview-context pre').innerText(), /"status": "No data"/);
    const historyClock = await page.evaluate(() => document.querySelector('iframe').contentWindow.Date.now());
    for (const range of ['1h', '6h', '24h', '7d']) {
        await frame().getByRole('button', { name: range, exact: true }).click();
        await frame().locator('.history-range-picker .btn-primary').filter({ hasText: range }).waitFor();
        await frame().locator('.history-activity-empty').waitFor();
        assert.equal(await page.evaluate(() => document.querySelector('iframe').contentWindow.Date.now()), historyClock);
        assert.equal(await page.getByRole('alert').count(), 0);
    }
    await frame().locator('.history-auto-refresh input').uncheck();
    await frame().locator('.history-auto-refresh input').check();
    await frame().locator('.history-activity-empty').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('caddy_ui_token')), 'parent-session-sentinel');
    await keyList.getByRole('button', { name: 'routes.noneConfigured', exact: true }).click();
    await frame().locator('[data-preview-key="routes.noneConfigured"]').waitFor();
    assert.ok(await page.evaluate(() => Math.abs(Date.now() - document.querySelector('iframe').contentWindow.Date.now()) < 100));

    await walk('caddyfile');
    await go('caddyfile.paneSizes', 'caddyfile-empty');
    const separator = frame().getByRole('separator');
    const oldSize = await separator.getAttribute('aria-valuenow');
    await separator.focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(oldSize => document.querySelector('iframe').contentDocument.querySelector('[role="separator"]').getAttribute('aria-valuenow') !== oldSize, oldSize);
    await page.locator('.preview-context summary').click();
    assert.match(await page.locator('.preview-context pre').innerText(), /aria-valuetext/);
    await go('caddyfile.forceSaveConfirm', 'caddyfile-force-confirm');
    await frame().locator('.modal .btn-danger').click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded request: PUT /api/caddyfile?fmt=true&sort=true&validate=false' }).waitFor();
    await go('caddyfile.deleteSnapshotConfirm', 'caddyfile-delete-confirm');
    await frame().locator('.modal .btn-danger').click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded request: DELETE /api/caddyfile/history/' }).waitFor();
    await go('caddyfile.importConfirm', 'caddyfile-import-confirm');
    await frame().locator('.modal .btn-primary').click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded request: PUT /api/caddyfile' }).waitFor();
    await go('caddyfile.restoreConfirm', 'caddyfile-restore-confirm');
    await frame().locator('.modal .btn-primary').click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded request: PUT /api/caddyfile' }).waitFor();
    await go('caddyfile.sortEntries', 'caddyfile-editor');
    await frame().locator('.cm-content').fill('# Local unsaved draft');
    await editor.fill(`${en.caddyfile.sortEntries} [preview]`);
    assert.match(await frame().locator('.cm-content').innerText(), /Local unsaved draft/);
    await frame().locator('.editor-toolbar-actions > button').nth(2).click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded window: /api/caddyfile?download=true' }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('caddy_ui_token')), 'parent-session-sentinel');

    await walk('instances', 'uptime-populated');
    await go('instances.name', 'instances-add');
    await frame().locator('.modal input').first().fill('Local draft');
    await editor.fill(`${en.instances.name} [preview]`);
    assert.equal(await frame().locator('.modal input').first().inputValue(), 'Local draft');
    await frame().locator('.modal input').nth(1).fill('http://caddy-preview:2019');
    await frame().locator('.modal .btn-primary').click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded request: POST /api/instances' }).waitFor();
    await go('instances.editInstance', 'instances-edit');
    await frame().locator('.modal .btn-primary').click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded request: PUT /api/instances/local-preview' }).waitFor();
    await go('instances.removeConfirm', 'instances-remove');
    await page.locator('.preview-context summary').click();
    assert.match(await page.locator('.preview-context pre').innerText(), /"name": "Local Preview"/);
    await frame().locator('.modal .btn-danger').click();
    await page.getByRole('alert').filter({ hasText: 'Unrecorded request: DELETE /api/instances/local-preview' }).waitFor();
    await go('instances.emptyHint', 'instances-empty');
    const discoveryToasts = await frame().locator('.toast-success').count();
    await frame().getByRole('button', { name: 'Discover Containers', exact: true }).click();
    await page.waitForFunction(count => document.querySelector('iframe').contentDocument.querySelectorAll('.toast-success').length > count, discoveryToasts);
    assert.equal(await page.getByRole('alert').count(), 0);
    await go('tls.orphanedCount_one', 'tls-internal-orphaned');
    await page.locator('.preview-context summary').click();
    assert.match(await page.locator('.preview-context pre').innerText(), /"count": 1/);
    await frame().locator('tbody tr').filter({ hasText: 'preview.internal' }).waitFor();
    await go('uptime.avgUptime', 'uptime-route-pending');
    await frame().locator('.uptime-row').filter({ hasText: 'preview.internal' }).waitFor();
    assert.equal(await frame().locator('.stat-val').nth(1).innerText(), '—');
    await frame().getByTitle(en.uptime.stopChecks.replace('{{host}}', 'preview.internal'), { exact: true }).click();
    await frame().getByTitle('Resume route checks for preview.internal', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('caddy_ui_token')), 'parent-session-sentinel');

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
    console.log('Playground Chromium checks passed.');
} finally {
    await browser?.close();
    await vite.close();
}

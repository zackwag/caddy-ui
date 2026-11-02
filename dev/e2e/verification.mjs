import assert from 'node:assert/strict';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { before, test } from 'node:test';
import en from '../../src/frontend/src/i18n/locales/en.js';
import { prepareBrowserTests, useBrowserFixture } from './fixture.mjs';

before(prepareBrowserTests, { timeout: 35000 });

test('a saved change reports its warning even when the editor refresh after it fails', { timeout: 120000 }, async t => {
    const { stack, page, origin, waitForView } = await useBrowserFixture(t);
    const initial = (await stack.api('/caddyfile')).data;

    // A real save that succeeds with a warning: its history version can't be
    // recorded. Only the refresh that follows it fails. The editor loads the
    // baseline, since a save over a file changed since loading is refused.
    const baseline = initial.replace('Caddy UI test instance:', 'history-baseline:');
    assert.equal((await stack.api('/caddyfile?fmt=false&sort=false', { method: 'PUT', body: baseline, plain: true })).status, 200);
    await page.goto(origin + '/caddyfile', { waitUntil: 'domcontentloaded' });
    await waitForView('.cm-editor');
    const historyPath = join(stack.directory, 'backend/history');
    await chmod(historyPath, 0o500);
    try {
        await page.route(url => url.pathname === '/api/caddyfile', route => route.request().method() === 'GET'
            ? route.fulfill({ status: 500, json: { code: 'CADDYFILE_READ_FAILED', error: 'Operation failed' } })
            : route.fallback());

        await page.locator('.cm-content').click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.insertText(baseline.replace('history-baseline:', 'warning-before-refresh:'));
        const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/caddyfile'
            && response.request().method() === 'PUT');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        assert.equal((await (await saved).json()).warningCode, 'CADDYFILE_HISTORY_COMMIT_FAILED');

        const warning = page.locator('.toast-info').filter({ hasText: en.errors.caddyfileHistoryCommitFailed });
        await warning.waitFor();
        assert.equal(await warning.locator('code').innerText(), 'CADDYFILE_HISTORY_COMMIT_FAILED');
        await page.locator('.toast-error').filter({ hasText: en.errors.caddyfileReadFailed }).waitFor();
        assert((await stack.api('/caddyfile')).data.includes('warning-before-refresh:'), 'The save itself was applied');
        assert((await page.locator('.cm-content').innerText()).includes('warning-before-refresh:'), 'The editor keeps its contents');
    } finally { await chmod(historyPath, 0o700); }
});

test('a route edit refused for a concurrent change explains it and shows the current routes', { timeout: 120000 }, async t => {
    const { stack, page, origin, waitForView } = await useBrowserFixture(t);
    const added = await stack.api('/routes', { method: 'POST', body: { domain: 'conflict-ui.test', upstream: '127.0.0.1:9' } });
    assert.equal(added.status, 201, JSON.stringify(added.data));
    const { id } = added.data;
    await page.goto(origin + '/routes', { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr').filter({ hasText: 'conflict-ui.test' });
    await waitForView('tr:has-text("conflict-ui.test")');

    // Caddy refused the write because the route changed since it was read
    const conflict = { code: 'CONFIG_CHANGED', error: 'Operation failed' };
    await page.route(url => url.pathname === `/api/routes/${id}`, route => ['PATCH', 'DELETE'].includes(route.request().method())
        ? route.fulfill({ status: 409, json: conflict }) : route.fallback());
    const refreshed = () => page.waitForRequest(request => new URL(request.url()).pathname === '/api/routes' && request.method() === 'GET');

    const conflicts = page.locator('.toast-error').filter({ hasText: en.errors.configChanged });

    // An edit based on the stale route closes, and the list reloads
    await row.getByTitle(en.routes.editRoute).click();
    const modal = page.locator('.modal').filter({ hasText: en.routes.editRoute });
    await modal.waitFor();
    await modal.locator('input[placeholder="192.168.4.88:8080"]').fill('127.0.0.1:10');
    let refresh = refreshed();
    await modal.getByRole('button', { name: en.common.save, exact: true }).click();
    await conflicts.first().waitFor();
    assert.equal(await conflicts.first().locator('code').innerText(), 'CONFIG_CHANGED');
    await refresh;
    await modal.waitFor({ state: 'detached' });

    refresh = refreshed();
    await row.getByRole('button', { name: en.common.delete, exact: true }).click();
    await page.locator('.modal--confirm').getByRole('button', { name: en.common.delete, exact: true }).click();
    await conflicts.nth(1).waitFor();
    await refresh;
    await row.waitFor();
});

test('the editor refuses to overwrite a newer Caddyfile and lets the user compare, overwrite or load it', { timeout: 120000 }, async t => {
    const { stack, page, context, origin, waitForView } = await useBrowserFixture(t);
    const { instance } = stack.instances.get('alpha');
    const initial = (await stack.api('/caddyfile')).data;
    const marked = marker => initial.replace('Caddy UI test instance:', `${marker}:`);
    const file = async () => (await stack.api('/caddyfile')).data;
    const replaceText = async (tab, text) => {
        await tab.locator('.cm-content').click();
        await tab.keyboard.press('ControlOrMeta+a');
        await tab.keyboard.insertText(text);
    };
    const saveIn = async tab => {
        const saved = tab.waitForResponse(response => new URL(response.url()).pathname === '/api/caddyfile' && response.request().method() === 'PUT');
        await tab.getByRole('button', { name: en.common.save, exact: true }).click();
        return saved;
    };

    // Two tabs load the same file; the second saves first
    await page.goto(origin + '/caddyfile', { waitUntil: 'domcontentloaded' });
    await waitForView('.cm-editor');
    const other = await context.newPage();
    t.after(() => other.close());
    await other.goto(origin + '/caddyfile', { waitUntil: 'domcontentloaded' });
    await other.locator('.cm-editor').waitFor();
    await replaceText(other, marked('other-tab'));
    assert.equal((await saveIn(other)).status(), 200);

    await replaceText(page, marked('this-tab'));
    assert.equal((await saveIn(page)).status(), 409);
    const dialog = page.getByRole('dialog', { name: en.caddyfile.conflictTitle });
    await dialog.waitFor();
    // Saves from the editor are formatted and sorted, so compare by marker
    assert.ok((await file()).includes('other-tab:'), 'the other tab\'s save is kept');

    await dialog.getByRole('button', { name: en.caddyfile.conflictCompare }).click();
    const diff = dialog.getByRole('region', { name: en.caddyfile.conflictDiff });
    await diff.locator('.diff-line--del', { hasText: 'other-tab:' }).waitFor();
    await diff.locator('.diff-line--add', { hasText: 'this-tab:' }).waitFor();

    const overwritten = page.waitForResponse(response => new URL(response.url()).pathname === '/api/caddyfile' && response.request().method() === 'PUT');
    await dialog.getByRole('button', { name: en.caddyfile.conflictOverwrite }).click();
    assert.equal((await overwritten).status(), 200);
    await dialog.waitFor({ state: 'detached' });
    assert.ok((await file()).includes('this-tab:') && !(await file()).includes('other-tab:'));

    // An edit made on the host, then a save from the stale editor
    await page.locator('.editor-hint--desktop', { hasText: en.caddyfile.upToDate }).waitFor();
    await stack.harness.run(['exec', instance.containerName, 'sh', '-c', 'printf "%s" "$1" > "$2"', 'sh', marked('host-edit'), instance.configPath]);
    await replaceText(page, marked('stale-edit'));
    assert.equal((await saveIn(page)).status(), 409);
    await dialog.waitFor();
    await dialog.getByRole('button', { name: en.caddyfile.conflictLoadCurrent }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.ok((await page.locator('.cm-content').innerText()).includes('host-edit:'), 'the editor shows the current file');
    assert.equal(await file(), marked('host-edit'));
    assert.ok(await page.getByRole('button', { name: en.common.save, exact: true }).isDisabled(), 'nothing is left unsaved');
});

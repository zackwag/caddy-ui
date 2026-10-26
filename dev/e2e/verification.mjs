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
    await page.goto(origin + '/caddyfile', { waitUntil: 'domcontentloaded' });
    await waitForView('.cm-editor');

    // A real save that succeeds with a warning: its history version can't be
    // recorded. Only the refresh that follows it fails.
    const baseline = initial.replace('Caddy UI test instance:', 'history-baseline:');
    assert.equal((await stack.api('/caddyfile?fmt=false&sort=false', { method: 'PUT', body: baseline, plain: true })).status, 200);
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

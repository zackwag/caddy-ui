import assert from 'node:assert/strict';
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { prepareBrowserTests, useBrowserFixture } from './fixture.mjs';

before(prepareBrowserTests, { timeout: 35000 });

test('saved versions show stable attribution, preserve unknown external edits and restore as new commits', { timeout: 120000 }, async t => {
    const { stack, page, origin } = await useBrowserFixture(t);
    const initial = (await stack.api('/caddyfile')).data;
    const edit = async text => {
        await page.locator('.cm-content').click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.insertText(text);
    };
    const save = async () => {
        const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/caddyfile'
            && response.request().method() === 'PUT');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        assert.equal((await pending).status(), 200);
        await page.getByText('Caddyfile saved and reloaded', { exact: true }).last().waitFor();
    };
    await page.goto(origin + '/caddyfile', { waitUntil: 'domcontentloaded' });
    await page.locator('.cm-editor').waitFor();
    await edit(initial.replace('Caddy UI test instance:', 'first-attributed-save:'));
    assert.equal((await stack.api('/caddyfile/history')).data.length, 0, 'WIP does not create versions');
    await save();
    let entries = (await stack.api('/caddyfile/history')).data;
    assert.equal(entries.length, 2);
    const first = entries[0];
    assert.equal(first.actor.type, 'user');
    assert.equal(first.actor.name, stack.credentials.username);
    assert.equal(first.parent, entries[1].filename);
    assert.equal(entries[1].actor, null);
    assert.equal((await stack.api('/caddyfile/history/' + entries[1].filename)).data, initial);
    assert((await stack.api('/caddyfile/history/' + first.filename)).data.includes('first-attributed-save'));
    const snapshotPath = join(stack.directory, 'backend/history', first.filename);
    const immutable = await readFile(snapshotPath, 'utf8');
    await page.getByRole('button', { name: /^History/ }).click();
    await page.getByRole('group', { name: 'Version details' }).waitFor();
    assert((await page.locator('.history-attribution').textContent()).includes('User: ' + stack.credentials.username));
    assert.equal(await page.getByRole('combobox', { name: 'Compare against' }).inputValue(), first.parent);
    assert((await page.locator('.history-diff').textContent()).includes('first-attributed-save'));

    // Rename through the authenticated API; other browser sessions must sign in again.
    const renamed = 'renamed-administrator';
    assert.equal((await stack.api('/auth/credentials', { method: 'PATCH', body: {
        currentPassword: stack.credentials.password, username: renamed,
    } })).status, 200);
    entries = (await stack.api('/caddyfile/history')).data;
    assert.equal(entries[0].actor.id, first.actor.id);
    assert.equal(entries[0].actor.name, renamed);
    assert.equal(await readFile(snapshotPath, 'utf8'), immutable);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByLabel('Username', { exact: true }).fill(renamed);
    await page.getByLabel('Password', { exact: true }).fill(stack.credentials.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('.shell').waitFor();
    await page.goto(origin + '/caddyfile', { waitUntil: 'domcontentloaded' });
    await page.locator('.cm-editor').waitFor();
    await page.getByRole('button', { name: /^History/ }).click();
    await page.getByText('User: ' + renamed, { exact: false }).first().waitFor();

    // Bypass the UI on this fixture's owned container, without claiming an actor.
    const instance = stack.instances.get('alpha').instance;
    await stack.harness.run(['exec', instance.containerName, 'sh', '-c',
        'printf "\\n# external-history-edit\\n" >> "$1"', 'history-test', instance.configPath]);
    const external = (await stack.api('/caddyfile')).data;
    assert(external.includes('external-history-edit'));
    await edit(external.replace('first-attributed-save:', 'second-attributed-save:'));
    await save();
    entries = (await stack.api('/caddyfile/history')).data;
    assert.equal(entries[0].actor.id, first.actor.id);
    assert.equal(entries[1].actor, null);
    assert.equal(entries[1].outcome, 'unknown');
    assert.equal((await stack.api('/caddyfile/history/' + entries[1].filename)).data, external);
    const externalVersion = entries[1];
    await page.waitForFunction(() => document.querySelector('.history-attribution')?.textContent.includes('Compared version — Unknown'));

    await page.getByRole('button', { name: 'Show version list', exact: true }).click();
    await page.getByTitle(externalVersion.filename, { exact: true }).click();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.locator('.modal--confirm').getByRole('button', { name: 'Restore', exact: true }).click();
    await page.getByText(/^Restored from/).waitFor();
    const restored = (await stack.api('/caddyfile/history')).data;
    assert.notEqual(restored[0].filename, first.filename);
    assert.equal(restored[0].actor.id, first.actor.id);
    assert.equal(restored[0].actor.name, renamed);
    assert.equal(restored[0].action, 'caddyfile.restore');
    assert.equal((await stack.api('/caddyfile/history/' + restored[0].filename)).data, external);
    assert.equal(await readFile(snapshotPath, 'utf8'), immutable);

    const token = await stack.api('/auth/tokens', { method: 'POST', body: {
        name: 'Read-only automation', scopes: ['status:read'], instanceIds: ['default'], expiresInDays: 1,
    } });
    assert.equal(token.status, 201);
    const forbidden = await fetch(stack.url + '/api/caddyfile', { method: 'PUT',
        headers: { Authorization: 'Bearer ' + token.data.token, 'Content-Type': 'text/plain', 'X-Actor-Id': first.actor.id }, body: initial });
    assert.equal(forbidden.status, 403);
    assert.equal((await stack.api('/caddyfile/history')).data.length, restored.length);
    await page.getByRole('button', { name: /^History/ }).click();
    await page.getByRole('group', { name: 'Version details' }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.history-attribution').scrollIntoViewIfNeeded();
    assert(await page.locator('.history-attribution').isVisible());
});

test('history commit warnings keep successful saves usable and imports record their own action', { timeout: 120000 }, async t => {
    const { stack, page, origin } = await useBrowserFixture(t);
    const initial = (await stack.api('/caddyfile')).data;
    await page.goto(origin + '/caddyfile', { waitUntil: 'domcontentloaded' });
    await page.locator('.cm-editor').waitFor();
    const edit = async text => {
        await page.locator('.cm-content').click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.insertText(text);
    };
    const save = async () => {
        const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/caddyfile'
            && response.request().method() === 'PUT');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        return response;
    };
    await edit(initial.replace('Caddy UI test instance:', 'baseline-history-warning:'));
    assert.equal((await save()).status(), 200);
    await page.getByText('Caddyfile saved and reloaded', { exact: true }).last().waitFor();
    const baseline = (await stack.api('/caddyfile')).data;
    const historyPath = join(stack.directory, 'backend/history');
    await chmod(historyPath, 0o500);
    try {
        await edit(baseline.replace('baseline-history-warning:', 'saved-with-history-warning:'));
        const response = await save();
        assert.equal(response.status(), 200);
        assert.equal((await response.json()).warningCode, 'CADDYFILE_HISTORY_COMMIT_FAILED');
        const warning = page.locator('.toast-info').filter({ hasText: 'The operation completed with warnings.' });
        await warning.waitFor();
        assert.equal(await warning.locator('code').innerText(), 'CADDYFILE_HISTORY_COMMIT_FAILED');
        assert((await stack.api('/caddyfile')).data.includes('saved-with-history-warning:'));
        await page.waitForFunction(() => [...document.querySelectorAll('button')]
            .some(button => button.textContent.trim() === 'Save' && button.disabled));
    } finally { await chmod(historyPath, 0o700); }

    const text = baseline.replace('baseline-history-warning:', 'imported-history-action:');
    await page.locator('input[type="file"]').setInputFiles({ name: 'Caddyfile.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
    await page.locator('.modal--confirm').getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByText('Caddyfile imported and reloaded', { exact: true }).waitFor();
    const entries = (await stack.api('/caddyfile/history')).data;
    assert.equal(entries[0].action, 'caddyfile.import');
    assert.equal(entries[0].actor.type, 'user');
    assert((await stack.api('/caddyfile/history/' + entries[0].filename)).data.includes('imported-history-action:'));
});

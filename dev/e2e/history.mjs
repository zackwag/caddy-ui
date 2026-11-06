import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { before, test } from 'node:test';
import { caddyGet, caddyPatch, caddyPost } from '../../src/backend/src/caddy.js';
import { readContainerFile, writeContainerFile } from '../../src/backend/src/containerFs.js';
import { prepareBrowserTests, useBrowserFixture } from './fixture.mjs';

before(prepareBrowserTests, { timeout: 35000 });

test('external file and admin API changes have independent Unknown-author diffs with protected access and retryable storage failures', { timeout: 120000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-ui-external-history-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const entry = join(directory, 'backend.mjs');
    const moduleUrl = file => pathToFileURL(resolve(import.meta.dirname, '../..', file)).href;
    // Exercise the real monitor over the owned backend's IPC channel, without
    // exposing a test endpoint or waiting a minute for each production poll.
    await writeFile(entry, `
        await import(${JSON.stringify(moduleUrl('src/backend/src/index.js'))});
        const drift = await import(${JSON.stringify(moduleUrl('src/backend/src/configDrift.js'))});
        const nativeFetch = globalThis.fetch;
        let failRead = false;
        globalThis.fetch = (url, options) => {
            if (failRead && String(url).endsWith('/config/')) {
                failRead = false;
                return Promise.reject(new TypeError('Injected unavailable config read'));
            }
            return nativeFetch(url, options);
        };
        process.on('message', async message => {
            if (message?.type !== 'test:history-check') return;
            if (message.reset) drift.resetConfigDrift();
            failRead = Boolean(message.failRead);
            await drift.checkAllInstances();
            process.send({ type: 'test:history-result', state: drift.getConfigDriftState('default') });
        });
    `);
    const { stack, page, origin } = await useBrowserFixture(t, { backendEntry: entry });
    const check = (options = {}) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => finish(new Error('History IPC check timed out')), 15000);
        const listener = message => { if (message?.type === 'test:history-result') finish(null, message.state); };
        function finish(error, state) {
            clearTimeout(timeout);
            stack.backend.removeListener('message', listener);
            if (error) reject(error); else resolve(state);
        }
        stack.backend.on('message', listener);
        stack.backend.send({ type: 'test:history-check', ...options }, error => { if (error) finish(error); });
    });
    await check({ reset: true });
    const instance = stack.instances.get('alpha').instance;
    const initial = (await stack.api('/caddyfile')).data;
    const fileEdit = initial + '\n# external-file-history\n';
    await writeContainerFile(instance.containerName, instance.configPath, fileEdit);
    await check();
    let entries = (await stack.api('/caddyfile/history')).data;
    assert.equal(entries.length, 1, 'Polling records the file without a later UI save');
    assert.deepEqual(entries[0].representations, ['file']);
    assert.equal(entries[0].actor, null);
    const fileObservation = (await stack.api(`/caddyfile/history/${entries[0].filename}/changes`)).data;
    assert.equal(fileObservation.instanceId, 'default');
    assert.equal(fileObservation.before.file, initial);
    assert.equal(fileObservation.after.file, fileEdit);
    const saved = await stack.api('/caddyfile?fmt=false&sort=false', { method: 'PUT', plain: true, body: fileEdit + '# local save\n' });
    assert.equal(saved.status, 200);
    assert.equal((await stack.api('/routes', { method: 'POST', body: { domain: 'local-history.test', upstream: '127.0.0.1:9' } })).status, 201);
    await check();
    entries = (await stack.api('/caddyfile/history')).data;
    assert.equal(entries.filter(entry => entry.kind === 'external').length, 1, 'Save-time discovery deduplicates polling; verified local writes keep their attribution');
    assert.equal(entries[0].action, 'route.add');
    assert.equal(entries[0].actor.name, stack.credentials.username);

    const fileBeforeApi = await readContainerFile(instance.containerName, instance.configPath);
    const liveBeforeApi = await caddyGet('/config/', instance.adminUrl);
    const injection = '<img src=x onerror="window.historyInjection=true">';
    const route = { '@id': 'external-history-route', match: [{ host: ['external-history.test'] }], handle: [{ handler: 'static_response', body: injection }] };
    await caddyPost(`/config/apps/http/servers/${instance.serverName}/routes`, route, instance.adminUrl);
    await check();
    entries = (await stack.api('/caddyfile/history')).data;
    const apiEntry = entries[0];
    assert.deepEqual(apiEntry.representations, ['live']);
    assert.equal(apiEntry.hasFile, false);
    assert.equal(apiEntry.actor, null);
    assert(!JSON.stringify(entries).includes(injection), 'List metadata does not contain configuration');
    const changes = (await stack.api(`/caddyfile/history/${apiEntry.filename}/changes`)).data;
    assert.deepEqual(JSON.parse(changes.before.live), liveBeforeApi);
    assert.deepEqual(JSON.parse(changes.after.live), await caddyGet('/config/', instance.adminUrl));
    assert.equal((await stack.api(`/caddyfile/history/${apiEntry.filename}`)).status, 409, 'JSON is not downloadable as a Caddyfile');
    assert.equal(await readContainerFile(instance.containerName, instance.configPath), fileBeforeApi);
    assert.equal((await fetch(stack.url + `/api/caddyfile/history/${apiEntry.filename}/changes`)).status, 401);
    const token = await stack.api('/auth/tokens', { method: 'POST', body: { name: 'History access probe', scopes: ['status:read'], instanceIds: ['default'], expiresInDays: 1 } });
    assert.equal(token.status, 201);
    assert.equal((await fetch(stack.url + `/api/caddyfile/history/${apiEntry.filename}/changes`, { headers: { Authorization: 'Bearer ' + token.data.token } })).status, 403);

    async function openLatest() {
        await page.goto(origin + '/caddyfile', { waitUntil: 'domcontentloaded' });
        await page.locator('.cm-editor').waitFor();
        await page.getByRole('button', { name: /^History/ }).click();
        await page.getByRole('region', { name: 'External configuration changes' }).waitFor();
    }
    await openLatest();
    assert((await page.locator('.history-attribution').innerText()).includes('Detected '));
    assert((await page.locator('.history-attribution').innerText()).includes('Unknown'));
    assert(await page.getByRole('button', { name: 'Restore', exact: true }).isDisabled());
    assert.equal(await page.getByRole('combobox', { name: 'Compare against' }).count(), 0);
    assert.equal(await page.locator('.history-external img').count(), 0);
    await page.getByRole('button', { name: 'Raw', exact: true }).click();
    const rawConfig = JSON.parse(await page.locator('.history-external pre').innerText());
    assert.equal(rawConfig.apps.http.servers[instance.serverName].routes.find(candidate => candidate['@id'] === route['@id']).handle[0].body, injection);
    assert.equal(await page.evaluate(() => window.historyInjection), undefined);

    await writeContainerFile(instance.containerName, instance.configPath, fileBeforeApi + '# combined external change\n');
    await caddyPatch('/id/external-history-route', { ...route, handle: [{ handler: 'static_response', body: 'combined external' }] }, instance.adminUrl);
    await check();
    await openLatest();
    await page.getByRole('heading', { name: 'Caddyfile', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Live configuration (JSON)', exact: true }).waitFor();
    assert((await page.locator('.history-external').innerText()).includes('A shared cause or successful reload has not been established.'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.history-external').scrollIntoViewIfNeeded();
    assert(await page.locator('.history-external').isVisible());
    await page.screenshot({ path: '/tmp/caddy-ui-377-external-history.png' });
    await page.setViewportSize({ width: 1440, height: 900 });

    // Record missing baselines explicitly when a representation first becomes readable.
    await check({ reset: true, failRead: true });
    await check();
    await openLatest();
    assert((await page.locator('.history-external').innerText()).includes('The previous observation is unavailable.'));

    const historyPath = join(stack.directory, 'backend/history');
    const beforeFailure = (await stack.api('/caddyfile')).data;
    const externalAfterFailure = beforeFailure + '# preserve across history failure\n';
    await writeContainerFile(instance.containerName, instance.configPath, externalAfterFailure);
    const countBeforeFailure = (await stack.api('/caddyfile/history')).data.length;
    await chmod(historyPath, 0o500);
    try {
        await check();
        assert.equal((await stack.api('/caddyfile/history')).data.length, countBeforeFailure);
        const refused = await stack.api('/caddyfile?fmt=false&sort=false', { method: 'PUT', plain: true, body: initial });
        assert.equal(refused.status, 500);
        assert.equal(refused.data.code, 'CADDYFILE_HISTORY_WRITE_FAILED');
        assert.equal(await readContainerFile(instance.containerName, instance.configPath), externalAfterFailure);
    } finally { await chmod(historyPath, 0o700); }
    await check();
    await check();
    entries = (await stack.api('/caddyfile/history')).data;
    assert.equal(entries.length, countBeforeFailure + 1, 'Repair retries the transition once');
    const repaired = (await stack.api(`/caddyfile/history/${entries[0].filename}/changes`)).data;
    assert.equal(repaired.before.file, beforeFailure);
    assert.equal(repaired.after.file, externalAfterFailure);
});

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
    // The editor loaded the file before the external edit, so the save is
    // refused until the user chooses to overwrite the file they were shown.
    const refused = page.waitForResponse(response => new URL(response.url()).pathname === '/api/caddyfile'
        && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    assert.equal((await refused).status(), 409);
    const conflict = page.getByRole('dialog', { name: 'The Caddyfile changed' });
    const overwritten = page.waitForResponse(response => new URL(response.url()).pathname === '/api/caddyfile'
        && response.request().method() === 'PUT');
    await conflict.getByRole('button', { name: 'Overwrite with my edits', exact: true }).click();
    assert.equal((await overwritten).status(), 200);
    await page.getByText('Caddyfile saved and reloaded', { exact: true }).last().waitFor();
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
    // The editor closes History once the restored file is reloaded, which can
    // land after the toast. Opening it again before then would toggle it shut.
    await page.getByRole('group', { name: 'Version details' }).waitFor({ state: 'detached' });
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
        const warning = page.locator('.toast-info').filter({ hasText: 'The Caddyfile was saved, but its history version could not be recorded.' });
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

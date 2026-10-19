import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { prepareBrowserTests, useBrowserFixture } from './fixture.mjs';

before(prepareBrowserTests, { timeout: 35000 });

test('the real UI issues, scopes and revokes read-only tokens without relaxing CSRF', { timeout: 120000 }, async t => {
    const { page, stack } = await useBrowserFixture(t);
    const urls = [];
    page.on('request', request => urls.push(request.url()));
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Security', exact: true });
    await dialog.getByLabel('Username', { exact: true }).fill('renamed-administrator');
    await dialog.getByLabel('Current password', { exact: true }).fill(stack.credentials.password);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: 'Administrator credentials updated.' }).waitFor();
    await dialog.getByRole('button', { name: 'API tokens', exact: true }).click();
    await dialog.getByLabel('Token name').fill('Homepage integration');
    await dialog.getByLabel('Expires after').selectOption('30');
    const selected = dialog.getByRole('group', { name: 'Allowed instances' }).getByRole('checkbox');
    assert.equal(await selected.count(), 1);
    await selected.uncheck();
    assert.equal(await dialog.getByRole('button', { name: 'Create token' }).isDisabled(), true);
    await selected.check();
    const forged = await page.evaluate(async () => (await fetch('/api/auth/tokens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'forged', scopes: ['status:read'], instanceIds: ['default'], expiresInDays: 30 }),
    })).status);
    assert.equal(forged, 403);
    const created = page.waitForResponse(response => response.url().endsWith('/api/auth/tokens') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Create token' }).click();
    const response = await created;
    assert.equal(response.status(), 201);
    assert.equal(response.headers()['cache-control'], 'no-store');
    const token = await dialog.getByLabel('API token', { exact: true }).inputValue();
    assert.match(token, /^cui_[A-Za-z0-9_-]{43}$/);
    assert.equal(await dialog.getByRole('button', { name: 'API tokens', exact: true }).isDisabled(), true);
    assert.equal(await dialog.getByRole('button', { name: 'User', exact: true }).isDisabled(), true);
    assert.equal(await dialog.getByLabel('Current password', { exact: true }).isDisabled(), true);
    const request = (path, options = {}) => fetch(stack.url + '/api' + path, {
        ...options, headers: { Authorization: 'Bearer ' + token, ...options.headers },
    });
    const status = await request('/status');
    assert.equal(status.status, 200);
    const statusData = await status.json();
    assert.equal(statusData.online, true);
    assert.equal(typeof statusData.routeCount, 'number');
    assert.equal('adminUrl' in statusData, false);
    assert.equal('servers' in statusData, false);
    const managementStatus = await page.evaluate(async () => (await fetch('/api/status')).json());
    assert.equal(typeof managementStatus.adminUrl, 'string');
    assert(Array.isArray(managementStatus.servers));
    assert.equal((await request('/metrics/raw')).status, 403);
    assert.equal((await request('/status', { headers: { 'X-Instance-Id': 'another-instance' } })).status, 403);
    assert.equal((await request('/settings', { method: 'PUT' })).status, 403);
    assert.equal(await page.evaluate(token => JSON.stringify({ ...localStorage }).includes(token), token), false);
    assert(urls.every(url => !url.includes(token)));
    assert.equal(await dialog.getByRole('button', { name: 'Close', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await dialog.getByLabel('API token', { exact: true }).inputValue(), token);
    await dialog.getByRole('button', { name: 'I have saved the token' }).click();
    assert.equal(await dialog.getByLabel('API token', { exact: true }).count(), 0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    await dialog.getByRole('button', { name: 'API tokens', exact: true }).click();
    await dialog.getByRole('button', { name: 'Revoke Homepage integration' }).waitFor();
    assert.equal((await dialog.innerText()).includes(token), false);
    await dialog.getByRole('button', { name: 'Revoke Homepage integration' }).click();
    await dialog.getByText('No API tokens have been issued.').waitFor();
    assert.equal((await request('/status')).status, 401);

    await page.setViewportSize({ width: 390, height: 500 });
    await dialog.getByLabel('Token name').fill('Prometheus integration');
    await dialog.getByLabel('Read status (Homepage)').uncheck();
    await dialog.getByLabel('Read metrics (Prometheus)').check();
    const bounds = await dialog.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await dialog.getByRole('button', { name: 'Create token' }).click();
    const metricsToken = await dialog.getByLabel('API token', { exact: true }).inputValue();
    const scrape = await fetch(stack.url + '/api/metrics/raw', { headers: { Authorization: 'Bearer ' + metricsToken } });
    assert.equal(scrape.status, 200);
    assert.match(await scrape.text(), /caddy_ui_caddy_metrics_up/);
    assert.equal((await fetch(stack.url + '/api/status', { headers: { Authorization: 'Bearer ' + metricsToken } })).status, 403);
    // A failed discard must preserve the one-time secret and let the user retry.
    await page.route('**/api/auth/tokens/*', route => route.fulfill({
        status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'AUTH_PERSISTENCE_FAILED' }),
    }));
    await dialog.getByRole('button', { name: 'Discard and revoke token' }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await dialog.getByLabel('API token', { exact: true }).inputValue(), metricsToken);
    assert.equal(await dialog.getByRole('button', { name: 'Close', exact: true }).isDisabled(), true);
    await page.unroute('**/api/auth/tokens/*');
    await dialog.getByRole('button', { name: 'Discard and revoke token' }).click();
    await dialog.getByText('No API tokens have been issued.').waitFor();
    assert.equal((await fetch(stack.url + '/api/metrics/raw', { headers: { Authorization: 'Bearer ' + metricsToken } })).status, 401);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await dialog.isVisible(), false);
});

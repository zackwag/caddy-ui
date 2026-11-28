// Views that keep working when one of their requests fails, and edits that
// survive a stray Escape. The API is the real backend's, with the requests each
// scenario needs to fail or shape answered by the page.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { apiSignIn, useAuthBrowserFixture } from './fixture.mjs';

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const failure = route => json(route, { error: 'Operation failed', code: 'INTERNAL_ERROR' }, 500);

const ROUTES = {
    srv0: { listen: [':443'], routes: [
        { '@id': 'hostless', match: [{ path: ['/'] }], handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'a:1' }] }] },
        { '@id': 'hosted', match: [{ host: ['app.example.com'] }], handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'b:2' }] }] },
    ] },
};

async function setup(t, settings = {}) {
    const f = await useAuthBrowserFixture(t);
    await writeFile(f.env.INSTANCES_PATH, JSON.stringify([{ id: 'default', name: 'Local', adminUrl: 'http://127.0.0.1:9', containerName: '' }]));
    const current = JSON.parse(await readFile(f.env.SETTINGS_PATH, 'utf8'));
    await writeFile(f.env.SETTINGS_PATH, JSON.stringify({ ...current, ...settings }));
    await f.restart();
    const credentials = { username: 'administrator', password: randomBytes(24).toString('base64url') };
    await apiSignIn(f.context, f.origin, credentials, { enroll: true });
    return f;
}

async function mockRoutes(page) {
    await page.route('**/api/routes', route => json(route, Object.entries(ROUTES).flatMap(([name, server]) => server.routes.map(r => ({ ...r, _server: name })))));
    await page.route('**/api/route-notes', route => json(route, {}));
    await page.route('**/api/health/uptime*', route => json(route, {}));
    await page.route('**/api/routes/maintenance', route => json(route, {}));
}

test('a token can be created after the token list failed to load', { timeout: 90000 }, async t => {
    const f = await setup(t);
    const { page } = f;
    await page.route('**/api/auth/tokens', route => (route.request().method() === 'GET' ? failure(route) : route.fallback()));
    await page.goto(f.origin);
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Security', exact: true });
    await dialog.getByRole('button', { name: 'API tokens', exact: true }).click();
    await dialog.getByLabel('Token name').fill('After failed load');
    await dialog.getByRole('button', { name: 'Create token' }).click();
    const secret = await dialog.getByLabel('API token', { exact: true }).inputValue();
    assert.match(secret, /^cui_/);
    assert.equal(await dialog.getByText('No API tokens').count(), 0);
});

test('the passkey HTTPS hint shows when the passkey list fails over HTTP', { timeout: 90000 }, async t => {
    const f = await setup(t);
    const { page } = f;
    await page.route('**/api/auth/passkeys', failure);
    await page.goto(f.origin);
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Security', exact: true });
    await dialog.getByRole('button', { name: 'Auth', exact: true }).click();
    await dialog.getByRole('button', { name: 'Passkeys', exact: true }).click();
    await dialog.getByText('Passkeys need HTTPS.', { exact: false }).waitFor();
    await dialog.getByRole('button', { name: 'Open TLS' }).waitFor();
});

test('route edits: hostless routes have no title field, Escape keeps unsaved edits, a TLS failure is quiet', { timeout: 90000 }, async t => {
    const f = await setup(t);
    const { page } = f;
    await mockRoutes(page);
    let tlsRequested = false;
    await page.route('**/api/tls', route => { tlsRequested = true; return failure(route); });
    await page.goto(f.origin + '/routes');
    const edits = page.getByRole('button', { name: 'Edit Route' });
    await edits.first().waitFor();
    assert.equal(await edits.count(), 2);

    // Hostless UI-managed route: no title field
    await edits.nth(0).click();
    const modal = page.getByRole('dialog', { name: 'Edit Route' });
    await modal.waitFor();
    assert.equal(await modal.getByPlaceholder('e.g. Home Assistant').count(), 0);
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached' });

    // Hosted route: Escape outside a field keeps typed edits, and closes once clean
    await edits.nth(1).click();
    await modal.waitFor();
    const title = modal.getByPlaceholder('e.g. Home Assistant');
    await title.fill('Typed title');
    await modal.locator('.modal-title').click();
    await page.keyboard.press('Escape');
    assert.equal(await modal.isVisible(), true, 'a modal with unsaved edits stays open on Escape');
    await title.fill('');
    await modal.locator('.modal-title').click();
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached' });

    assert.equal(tlsRequested, true);
    assert.equal(await page.locator('.toast').filter({ hasText: /certificate/i }).count(), 0);
});

test('the fast route-status poll stops after one route-check round', { timeout: 120000 }, async t => {
    const f = await setup(t, { routeChecks: true });
    const { page } = f;
    await page.clock.install();
    await mockRoutes(page);
    let routeLoads = 0;
    page.on('request', request => {
        if (new URL(request.url()).pathname === '/api/routes') {
            routeLoads++;
        }
    });
    await page.goto(f.origin + '/routes');
    await page.getByRole('button', { name: 'Edit Route' }).first().waitFor();

    const loadsOver = async ms => {
        const before = routeLoads;
        await page.clock.runFor(ms);
        await page.waitForTimeout(500);
        return routeLoads - before;
    };
    const fast = await loadsOver(30_000);
    assert(fast >= 5, `polls fast while results are pending (${fast} loads in 30s)`);
    await page.clock.runFor(5 * 60_000);
    const slow = await loadsOver(60_000);
    assert(slow <= 3, `polls at the normal interval after one round (${slow} loads in 60s)`);
});

test('Escape keeps a new instance form that has unsaved input', { timeout: 90000 }, async t => {
    const f = await setup(t);
    const { page } = f;
    await page.goto(f.origin + '/instances');
    await page.getByRole('button', { name: '+ Add Instance' }).click();
    const modal = page.getByRole('dialog', { name: 'Add Instance' });
    await modal.locator('input').first().fill('Typed name');
    await modal.locator('.modal-title').click();
    await page.keyboard.press('Escape');
    assert.equal(await modal.isVisible(), true, 'a form with unsaved input stays open on Escape');
    await modal.locator('input').first().fill('');
    await modal.locator('.modal-title').click();
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached' });
});

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test, { before } from 'node:test';
import { prepareBrowserTests, useAuthBrowserFixture as fixture } from './fixture.mjs';

before(prepareBrowserTests, { timeout: 35000 });

const secret = () => randomBytes(24).toString('base64url');


async function completeSetup(page, password) {
    await page.getByLabel('Username', { exact: true }).fill('administrator');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password').fill(password);
    await page.getByRole('button', { name: 'Complete setup' }).click();
    const key = await page.getByLabel('Recovery key', { exact: true }).inputValue();
    assert(key.length > 40);
    await page.getByLabel('I have saved my recovery key').check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('.shell').waitFor();
    return key;
}

async function login(page, password, username = 'administrator') {
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('HTTP setup, session cookies, CSRF, logout and one-time recovery work in the real UI', { timeout: 60000 }, async t => {
    const f = await fixture(t);
    const { page, context } = f;
    await page.getByRole('heading', { name: 'Create administrator' }).waitFor();
    assert.equal(await page.evaluate(() => isSecureContext), false);
    await page.setViewportSize({ width: 390, height: 360 });
    await page.locator('.login-shell').evaluate(element => { element.scrollTop = 0; });
    assert((await page.locator('.login-card').boundingBox()).y >= 0, 'the form starts inside the viewport');
    const submit = page.getByRole('button', { name: 'Complete setup' });
    await submit.scrollIntoViewIfNeeded();
    const bounds = await submit.boundingBox();
    assert(bounds.y >= 0 && bounds.y + bounds.height <= 360, 'setup controls can scroll into view');
    const password = secret();
    const recoveryKey = await completeSetup(page, password);
    await page.setViewportSize({ width: 1440, height: 900 });
    const cookie = (await context.cookies()).find(value => value.name === 'caddy_ui_session');
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, false);
    assert.equal(cookie.sameSite, 'Strict');
    assert.equal(await page.evaluate(() => localStorage.getItem('caddy_ui_token')), null);
    assert.equal(await readFile(f.env.SETTINGS_PATH, 'utf8'), f.metadata);
    const forged = await page.evaluate(async () => (await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'de' }),
    })).status);
    assert.equal(forged, 403);
    assert.equal(await readFile(f.env.SETTINGS_PATH, 'utf8'), f.metadata);
    await page.reload();
    await page.locator('.shell').waitFor();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await login(page, secret());
    await page.getByRole('alert').filter({ hasText: 'Login failed' }).waitFor();
    await login(page, password);
    await page.locator('.shell').waitFor();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Use recovery key' }).click();
    await page.getByLabel('Recovery key', { exact: true }).fill(recoveryKey);
    const replacement = secret();
    await page.getByLabel('Password', { exact: true }).fill(replacement);
    await page.getByLabel('Confirm password').fill(replacement);
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await page.getByRole('heading', { name: 'Save your recovery key' }).waitFor();
    assert.notEqual(await page.getByLabel('Recovery key', { exact: true }).inputValue(), recoveryKey);
    await page.getByLabel('I have saved my recovery key').check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await login(page, replacement);
    await page.locator('.shell').waitFor();
    assert(f.urls.every(url => !/[?&]token=/.test(url)));
});

test('existing environment login enrolls credentials without changing installation metadata', { timeout: 60000 }, async t => {
    const { page, previous, env, metadata } = await fixture(t, true);
    await login(page, previous.password, previous.username);
    await page.getByRole('heading', { name: 'Create administrator' }).waitFor();
    await completeSetup(page, secret());
    assert.equal(await readFile(env.SETTINGS_PATH, 'utf8'), metadata);
});

test('Security sections update credentials on HTTP and preserve the current browser session', { timeout: 60000 }, async t => {
    const { page, context, env, metadata } = await fixture(t);
    const password = secret();
    await completeSetup(page, password);
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Security', exact: true });
    const user = dialog.getByRole('button', { name: 'User', exact: true });
    const tokens = dialog.getByRole('button', { name: 'API tokens', exact: true });
    assert.equal(await user.getAttribute('aria-expanded'), 'true');
    assert.equal(await tokens.getAttribute('aria-expanded'), 'false');
    await dialog.getByRole('button', { name: 'Auth', exact: true }).click();
    await dialog.getByText('Passkeys need HTTPS.', { exact: false }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Add passkey', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Auth', exact: true }).click();
    assert.equal(await dialog.getByLabel('Username', { exact: true }).inputValue(), 'administrator');
    await user.press('Enter');
    assert.equal(await dialog.getByLabel('Username', { exact: true }).isVisible(), false);
    await user.press('Enter');
    await tokens.click();
    await dialog.getByText('No API tokens have been issued.').waitFor();
    await tokens.click();
    const save = dialog.getByRole('button', { name: 'Save', exact: true });
    assert.equal(await save.isDisabled(), true);
    await dialog.getByLabel('Username', { exact: true }).fill('renamed-admin');
    await dialog.getByLabel('Current password', { exact: true }).fill(secret());
    await save.click();
    await dialog.getByRole('alert').filter({ hasText: 'The current password is incorrect.' }).waitFor();
    assert.equal(await dialog.getByLabel('Current password', { exact: true }).inputValue(), '');
    const oldCookie = (await context.cookies()).find(cookie => cookie.name === 'caddy_ui_session').value;
    await dialog.getByLabel('Current password', { exact: true }).fill(password);
    const updated = page.waitForResponse(response => response.url().endsWith('/api/auth/credentials') && response.request().method() === 'PATCH');
    await save.click();
    assert.equal((await updated).status(), 200);
    await dialog.getByRole('status').filter({ hasText: 'Administrator credentials updated.' }).waitFor();
    assert.notEqual((await context.cookies()).find(cookie => cookie.name === 'caddy_ui_session').value, oldCookie);
    assert.equal(await readFile(env.SETTINGS_PATH, 'utf8'), metadata);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await page.locator('.shell').waitFor();
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    assert.equal(await dialog.getByLabel('Username', { exact: true }).inputValue(), 'renamed-admin');
    const replacement = secret();
    await dialog.getByLabel('Current password', { exact: true }).fill(password);
    await dialog.getByLabel('New password', { exact: true }).fill(replacement);
    await dialog.getByLabel('Confirm password', { exact: true }).fill(secret());
    await save.click();
    await dialog.getByRole('alert').filter({ hasText: 'The passwords do not match.' }).waitFor();
    await dialog.getByLabel('Confirm password', { exact: true }).fill(replacement);
    await page.route('**/api/auth/credentials', route => route.request().method() === 'PATCH'
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'AUTH_PERSISTENCE_FAILED' }) })
        : route.continue());
    await save.click();
    await dialog.getByRole('alert').filter({ hasText: 'Credentials could not be saved.' }).waitFor();
    assert.equal(await dialog.getByLabel('New password', { exact: true }).inputValue(), replacement);
    assert.equal(await dialog.getByLabel('Current password', { exact: true }).inputValue(), '');
    await page.unroute('**/api/auth/credentials');
    await dialog.getByLabel('Current password', { exact: true }).fill(password);
    await save.click();
    await dialog.getByRole('status').filter({ hasText: 'Administrator credentials updated.' }).waitFor();
    assert.equal(await dialog.getByLabel('New password', { exact: true }).inputValue(), '');
    assert.equal(await dialog.getByLabel('Confirm password', { exact: true }).inputValue(), '');
    // A token mutation needs a fresh CSRF value after the session was renewed.
    const nextWrite = await page.evaluate(async () => {
        const { apiFetch } = await import('/src/utils/api.js');
        return apiFetch('/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'en' }) });
    });
    assert.equal(nextWrite.language, 'en');
    await page.setViewportSize({ width: 390, height: 500 });
    const bounds = await dialog.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert(bounds.y >= 0 && bounds.y + bounds.height <= 500);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await login(page, password, 'renamed-admin');
    await page.getByRole('alert').filter({ hasText: 'Login failed' }).waitFor();
    await login(page, replacement, 'renamed-admin');
    await page.locator('.shell').waitFor();
});

test('backend failure presents a retry screen instead of entering the application', { timeout: 30000 }, async t => {
    const { page, disconnect } = await fixture(t);
    await page.getByRole('heading', { name: 'Create administrator' }).waitFor();
    disconnect();
    await page.reload();
    await page.getByRole('alert').filter({ hasText: 'Could not reach the server' }).waitFor();
    assert.equal(await page.locator('.shell').count(), 0);
    await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
});

async function openPasskeys(page) {
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Security', exact: true });
    await dialog.getByRole('button', { name: 'User', exact: true }).click();
    await dialog.getByRole('button', { name: 'Auth', exact: true }).click();
    await dialog.getByText('No passkeys have been added.').or(dialog.getByRole('button', { name: /^Remove / })).first().waitFor();
    return dialog;
}

async function virtualAuthenticator(context, page) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
        isUserVerified: true, automaticPresenceSimulation: true,
    } });
    return { cdp, authenticatorId };
}

async function addPasskey(dialog, password, name) {
    await dialog.getByLabel('Passkey name', { exact: true }).fill(name);
    await dialog.getByLabel('Confirm your password', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: 'Add passkey', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: 'Passkey added.' }).waitFor();
}

test('HTTPS passkeys survive a backend replacement, sign in, and require a password for removal', { timeout: 90000 }, async t => {
    const f = await fixture(t, false, { https: true });
    const { page, context } = f;
    assert.equal(await page.evaluate(() => isSecureContext), true);
    const password = secret();
    await completeSetup(page, password);
    const device = await virtualAuthenticator(context, page);
    let dialog = await openPasskeys(page);
    await addPasskey(dialog, password, 'Laptop');
    assert.equal(await dialog.getByLabel('Confirm your password', { exact: true }).inputValue(), '');
    const persisted = JSON.parse(await readFile(f.env.AUTH_PATH, 'utf8'));
    assert.equal(persisted.passkeys.credentials.length, 1);
    assert(!JSON.stringify(persisted).includes(password));
    await page.setViewportSize({ width: 390, height: 700 });
    const bounds = await dialog.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await page.setViewportSize({ width: 1440, height: 900 });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await f.restart();
    await page.reload();
    await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await page.locator('.shell').waitFor();
    dialog = await openPasskeys(page);
    await dialog.getByRole('button', { name: 'Remove Laptop', exact: true }).click();
    await dialog.getByLabel('Password to remove this passkey').fill(secret());
    await dialog.getByRole('button', { name: 'Remove passkey', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: 'The current password is incorrect.' }).waitFor();
    await dialog.getByLabel('Password to remove this passkey').fill(password);
    await dialog.getByRole('button', { name: 'Remove passkey', exact: true }).click();
    await dialog.getByText('No passkeys have been added.').waitFor();
    assert.equal(JSON.parse(await readFile(f.env.AUTH_PATH, 'utf8')).passkeys.credentials.length, 0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).count(), 0);
    await login(page, password);
    await page.locator('.shell').waitFor();
    await device.cdp.detach();
});

test('HTTPS passkey enrollment checks each password, supports multiple authenticators and enforces three keys', { timeout: 90000 }, async t => {
    const { page, context } = await fixture(t, false, { https: true });
    const password = secret();
    await completeSetup(page, password);
    const dialog = await openPasskeys(page);
    for (const name of ['Laptop', 'Phone', 'Security key']) {
        const device = await virtualAuthenticator(context, page);
        if (name === 'Phone') {
            await dialog.getByLabel('Passkey name', { exact: true }).fill(name);
            await dialog.getByLabel('Confirm your password', { exact: true }).fill(secret());
            await dialog.getByRole('button', { name: 'Add passkey', exact: true }).click();
            await dialog.getByRole('alert').filter({ hasText: 'The current password is incorrect.' }).waitFor();
        }
        await addPasskey(dialog, password, name);
        await device.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: device.authenticatorId });
        await device.cdp.detach();
    }
    await dialog.getByText('You can register up to three passkeys.', { exact: false }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Add passkey', exact: true }).count(), 0);
    await dialog.getByRole('button', { name: 'Remove Phone', exact: true }).click();
    await dialog.getByLabel('Password to remove this passkey').fill(secret());
    await dialog.getByRole('button', { name: 'Remove passkey', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: 'The current password is incorrect.' }).waitFor();
    await dialog.getByText('3 of 3 passkeys registered').waitFor();
    await dialog.getByLabel('Password to remove this passkey').fill(password);
    await dialog.getByRole('button', { name: 'Remove passkey', exact: true }).click();
    await dialog.getByText('2 of 3 passkeys registered').waitFor();
});

test('HTTPS browsers distinguish missing passkey configuration from unsupported WebAuthn', { timeout: 60000 }, async t => {
    const { page } = await fixture(t, false, { https: true, configurePasskeys: false });
    await completeSetup(page, secret());
    const dialog = await openPasskeys(page);
    await dialog.getByText('Passkey setup is incomplete.', { exact: false }).waitFor();
    assert.equal(await dialog.getByText('Passkeys need HTTPS.', { exact: false }).count(), 0);
    await dialog.getByRole('button', { name: 'Auth', exact: true }).click();
    await page.evaluate(() => { window.PublicKeyCredential = undefined; });
    await dialog.getByRole('button', { name: 'Auth', exact: true }).click();
    await dialog.getByText('This browser does not support passkeys.', { exact: false }).waitFor();
});

test('IP-literal HTTPS addresses explain why passkeys are unavailable while password login works', { timeout: 60000 }, async t => {
    const { page } = await fixture(t, false, { https: true, httpsHostname: '127.0.0.1' });
    const password = secret();
    await completeSetup(page, password);
    const dialog = await openPasskeys(page);
    await dialog.getByText('Passkeys need a hostname,', { exact: false }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Add passkey', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByText('Passkeys need a hostname,', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).count(), 0);
    await login(page, password);
    await page.locator('.shell').waitFor();
});

test('Auth settings explain an origin mismatch instead of reporting missing configuration', { timeout: 60000 }, async t => {
    const { page } = await fixture(t, false, { https: true });
    await completeSetup(page, secret());
    await page.route('**/api/auth/passkeys', async route => {
        await route.fulfill({ json: { enabled: true, origin: 'https://configured.example.com',
            limit: 3, passkeys: [] } });
    });
    const dialog = await openPasskeys(page);
    await dialog.getByText('Passkeys are configured for a different address.', { exact: false }).waitFor();
    assert((await dialog.innerText()).includes('https://configured.example.com'));
    assert.equal(await dialog.getByText('Passkey setup is incomplete.', { exact: false }).count(), 0);
    assert.equal(await dialog.getByRole('button', { name: 'Add passkey', exact: true }).isDisabled(), true);
});

test('passkey sign-in explains an incompatible HTTPS origin and works at the configured address', { timeout: 60000 }, async t => {
    const { page, context, origin } = await fixture(t, false, { https: true });
    const password = secret();
    await completeSetup(page, password);
    const device = await virtualAuthenticator(context, page);
    const dialog = await openPasskeys(page);
    await addPasskey(dialog, password, 'Laptop');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    const alternate = new URL(origin);
    alternate.hostname = '127.0.0.1';
    await page.goto(alternate.origin);
    assert.equal(await page.evaluate(() => isSecureContext), true);
    const button = page.getByRole('button', { name: 'Sign in with a passkey', exact: true });
    await button.waitFor();
    assert.equal(await button.isDisabled(), true);
    await page.getByText('Passkeys are configured for a different address.', { exact: false }).waitFor();
    assert((await page.locator('.login-card').innerText()).includes(origin));
    await page.goto(origin);
    await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await page.locator('.shell').waitFor();
    await device.cdp.detach();
});

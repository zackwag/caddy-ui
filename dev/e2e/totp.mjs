import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import test, { before } from 'node:test';
import { prepareBrowserTests, useAuthBrowserFixture as fixture } from './fixture.mjs';

before(prepareBrowserTests, { timeout: 35000 });

// Independent RFC 6238 oracle: do not generate test codes with the validator.
function code(secret, step) {
    const bits = [...secret].map(char => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char).toString(2).padStart(5, '0')).join('');
    const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac('sha1', key).update(counter).digest();
    return ((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}
async function freshCode(path) {
    const { totp } = JSON.parse(await readFile(path, 'utf8'));
    const next = totp.lastAcceptedStep + 1;
    // The verifier accepts one future step; wait only if it was already used.
    if (next > Math.floor(Date.now() / 30000) + 1) await delay((next - 1) * 30000 - Date.now() + 100);
    return code(totp.secret, Math.max(next, Math.floor(Date.now() / 30000)));
}
async function setup(page) {
    const password = randomBytes(24).toString('base64url');
    await page.getByLabel('Username', { exact: true }).fill('administrator');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password').fill(password);
    await page.getByRole('button', { name: 'Complete setup' }).click();
    const recovery = await page.getByLabel('Recovery key', { exact: true }).inputValue();
    await page.getByLabel('I have saved my recovery key').check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('.shell').waitFor();
    return { password, recovery };
}
async function authPanel(page) {
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Security', exact: true });
    await dialog.getByRole('button', { name: 'Auth', exact: true }).click();
    await dialog.getByRole('button', { name: 'Authenticator app (TOTP)', exact: true }).click();
    return dialog;
}
async function enroll(dialog, password) {
    await dialog.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
    if (password) await dialog.locator('#totp-current-password').fill(password);
    await dialog.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
    const key = dialog.getByLabel('Authenticator setup key');
    await key.waitFor();
    const secret = await key.inputValue();
    assert.match(await dialog.getByAltText('Authenticator setup QR code').getAttribute('src'), /^data:image\/png;base64,/);
    await dialog.getByLabel('Authenticator code', { exact: true }).fill(code(secret, Math.floor(Date.now() / 30000)));
    await dialog.getByRole('button', { name: 'Confirm authenticator', exact: true }).click();
    await dialog.getByText('An authenticator is enabled.', { exact: true }).waitFor();
    assert.equal(await key.count(), 0, 'the seed is removed after confirmation');
    return secret;
}

test('HTTP TOTP survives replacement, gates password sign-in, and permits verified disabling', { timeout: 90000 }, async t => {
    const f = await fixture(t);
    const { page } = f;
    const { password } = await setup(page);
    let dialog = await authPanel(page);
    await dialog.getByText('This connection uses HTTP.', { exact: false }).waitFor();
    const seed = await enroll(dialog, password);
    assert.equal(JSON.parse(await readFile(f.env.AUTH_PATH, 'utf8')).totp.secret, seed);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await f.restart();
    await page.reload();
    await page.getByLabel('Username', { exact: true }).fill('administrator');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Verify your sign-in' }).waitFor();
    assert.equal(await page.locator('.shell').count(), 0);
    await page.reload();
    await page.getByRole('heading', { name: 'Verify your sign-in' }).waitFor();
    const previous = JSON.parse(await readFile(f.env.AUTH_PATH, 'utf8')).totp.lastAcceptedStep;
    await page.getByLabel('Authenticator code', { exact: true }).fill(code(seed, previous));
    await page.getByRole('button', { name: 'Verify code', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'That code is invalid or has already been used.' }).waitFor();
    await page.getByLabel('Authenticator code', { exact: true }).fill(await freshCode(f.env.AUTH_PATH));
    await page.getByRole('button', { name: 'Verify code', exact: true }).click();
    await page.locator('.shell').waitFor();
    dialog = await authPanel(page);
    await dialog.getByRole('button', { name: 'Disable authenticator', exact: true }).click();
    await dialog.locator('#totp-current-password').fill(password);
    await dialog.locator('#totp-current-password-totp').fill(await freshCode(f.env.AUTH_PATH));
    await dialog.getByRole('button', { name: 'Disable authenticator', exact: true }).click();
    await dialog.getByText('No authenticator is enabled.', { exact: true }).waitFor();
    assert(!JSON.parse(await readFile(f.env.AUTH_PATH, 'utf8')).totp);
});

test('HTTPS uses fresh passkey proof for TOTP changes and keeps passkey sign-in independent', { timeout: 60000 }, async t => {
    const f = await fixture(t, false, { https: true });
    const { page, context } = f;
    const { password } = await setup(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
        isUserVerified: true, automaticPresenceSimulation: true,
    } });
    let dialog = await authPanel(page);
    await dialog.getByRole('button', { name: 'Passkeys', exact: true }).click();
    await dialog.getByLabel('Passkey name', { exact: true }).fill('Laptop');
    await dialog.getByLabel('Confirm your password', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: 'Add passkey', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: 'Passkey added.' }).waitFor();
    await dialog.getByRole('button', { name: 'Passkeys', exact: true }).click();
    await enroll(dialog);
    assert.equal(await dialog.getByText('This connection uses HTTP.', { exact: false }).count(), 0);
    await page.setViewportSize({ width: 390, height: 700 });
    const bounds = await dialog.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await page.setViewportSize({ width: 1440, height: 900 });
    await dialog.getByRole('button', { name: 'Auth', exact: true }).click();
    await dialog.getByRole('button', { name: 'User', exact: true }).click();
    const replacement = randomBytes(24).toString('base64url');
    await dialog.getByLabel('New password', { exact: true }).fill(replacement);
    await dialog.getByLabel('Confirm password', { exact: true }).fill(replacement);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: 'Administrator credentials updated.' }).waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    // A replacement also checks that the new password, TOTP and passkey counter
    // coexist durably, without compressing every ceremony into one limiter window.
    await f.restart();
    await page.reload();
    await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await page.locator('.shell').waitFor();
    dialog = await authPanel(page);
    await dialog.getByRole('button', { name: 'Disable authenticator', exact: true }).click();
    await dialog.getByRole('button', { name: 'Disable authenticator', exact: true }).click();
    try { await dialog.getByText('No authenticator is enabled.', { exact: true }).waitFor(); }
    catch (cause) { throw new Error(await dialog.innerText(), { cause }); }
    await cdp.detach();
});

test('the UI preserves the account cooldown across reauthentication and fresh password sign-in', { timeout: 60000 }, async t => {
    const f = await fixture(t);
    const { page } = f;
    const { password } = await setup(page);
    const dialog = await authPanel(page);
    const seed = await enroll(dialog, password);
    const { totp } = JSON.parse(await readFile(f.env.AUTH_PATH, 'utf8'));
    const usedCode = code(seed, totp.lastAcceptedStep);
    await dialog.getByRole('button', { name: 'Disable authenticator', exact: true }).click();
    for (let i = 0; i < 4; i++) {
        await dialog.locator('#totp-current-password').fill(password);
        await dialog.locator('#totp-current-password-totp').fill(usedCode);
        const rejected = page.waitForResponse(response => response.url().endsWith('/api/auth/totp') && response.request().method() === 'DELETE');
        await dialog.getByRole('button', { name: 'Disable authenticator', exact: true }).click();
        assert.equal((await rejected).status(), 403);
        await page.waitForFunction(() => document.querySelector('#totp-current-password').value === '');
    }
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByLabel('Username', { exact: true }).fill('administrator');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    for (const status of [403, 429]) {
        await page.getByLabel('Authenticator code', { exact: true }).fill(usedCode);
        const rejected = page.waitForResponse(response => response.url().endsWith('/api/auth/sessions/totp'));
        await page.getByRole('button', { name: 'Verify code', exact: true }).click();
        assert.equal((await rejected).status(), status);
        await page.waitForFunction(() => document.querySelector('#login-totp').value === '');
    }
    await page.getByRole('alert').filter({ hasText: 'Too many incorrect authenticator codes.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Verify code', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Back to sign-in', exact: true }).click();
    await page.getByLabel('Username', { exact: true }).fill('administrator');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Too many incorrect authenticator codes.' }).waitFor();
    assert.equal(await page.locator('.shell').count(), 0);
});

import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Secret, TOTP } from 'otpauth';
import { authClient, authFixture } from './fixtures/auth.mjs';
import { authenticator } from './fixtures/webauthn.mjs';

const fixtures = [];
const request = (client, path, body, method = 'POST') => client.request('/auth' + path, { method, body });
async function fixture() {
    let time = Date.now();
    const f = await authFixture({ now: () => time, env: { CADDY_UI_EXTERNAL_URL: 'https://ui.example.com' } });
    fixtures.push(f);
    const client = authClient(f.url);
    const account = { username: 'admin', password: randomBytes(24).toString('base64url') };
    const setup = await request(client, '/setup', account);
    const device = authenticator();
    const options = await request(client, '/passkeys/registration/options', { name: 'Laptop', currentPassword: account.password });
    const key = await request(client, '/passkeys/registration', device.registration(options.data));
    expect(key.status).toBe(201);
    let counter = 0;
    async function grant(action = 'totp.setup', target = client, mutation = {}) {
        const options = await request(target, '/passkeys/reauthentication/options', { action });
        expect(options.status).toBe(200);
        return request(target, '/passkeys/reauthentication', device.assertion(options.data, { counter: ++counter, ...mutation }));
    }
    return { ...f, client, account, device, recoveryKey: setup.data.recoveryKey, key: key.data, grant, advance: ms => { time += ms; } };
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

describe('fresh passkey authorization for credential changes', () => {
    it('requires a management session and a verified assertion, rather than trusting a passkey-authenticated session', async () => {
        const f = await fixture();
        const anonymous = authClient(f.url);
        expect((await request(anonymous, '/passkeys/reauthentication/options', { action: 'totp.setup' })).status).toBe(401);
        const options = await request(anonymous, '/passkeys/authentication/options');
        expect((await request(anonymous, '/passkeys/authentication', f.device.assertion(options.data))).status).toBe(200);
        expect((await request(anonymous, '/totp/setup', {})).data.code).toBe('CURRENT_PASSWORD_INVALID');
        for (const mutation of [{ origin: 'https://evil.example.com' }, { verified: false }, { crossOrigin: true }]) {
            expect((await f.grant('totp.setup', anonymous, mutation)).data.code).toBe('PASSKEY_INVALID');
        }
        expect((await request(anonymous, '/totp/setup', { reauthToken: 'x'.repeat(43) })).data.code).toBe('REAUTH_INVALID');
    });
    it('binds grants to the session, action, expiry and a single attempt', async () => {
        const f = await fixture();
        const other = authClient(f.url);
        await request(other, '/sessions', f.account);
        const grant = (await f.grant()).data;
        expect((await request(other, '/totp/setup', grant)).data.code).toBe('REAUTH_INVALID');
        expect((await request(f.client, '/credentials', { ...grant, password: randomBytes(24).toString('base64url') }, 'PATCH')).data.code).toBe('REAUTH_INVALID');
        expect((await request(f.client, '/totp/setup', grant)).data.code).toBe('REAUTH_INVALID');
        const expired = (await f.grant()).data;
        f.advance(120001);
        expect((await request(f.client, '/totp/setup', expired)).data.code).toBe('REAUTH_INVALID');
        const valid = (await f.grant()).data;
        expect((await request(f.client, '/totp/setup', valid)).status).toBe(200);
        expect((await request(f.client, '/totp/setup', valid)).data.code).toBe('REAUTH_INVALID');
    });
    it('allows passkey proof instead of password/TOTP for password changes and adding/removing a key', async () => {
        const f = await fixture();
        const seed = await request(f.client, '/totp/setup', (await f.grant()).data);
        const code = new TOTP({ secret: Secret.fromBase32(seed.data.secret) }).generate();
        expect((await request(f.client, '/totp/confirm', { code })).status).toBe(200);
        const other = authClient(f.url);
        const options = await request(other, '/passkeys/authentication/options');
        // Counter one was used during setup reauthentication; counters must advance.
        expect((await request(other, '/passkeys/authentication', f.device.assertion(options.data, { counter: 2 }))).status).toBe(200);
        const password = randomBytes(24).toString('base64url');
        const proof = (await f.grant('password.change', f.client, { counter: 3 })).data;
        expect((await request(f.client, '/credentials', { ...proof, password }, 'PATCH')).status).toBe(200);
        const enrollment = await request(f.client, '/passkeys/registration/options', { name: 'Phone', ...(await f.grant('passkey.add', f.client, { counter: 4 })).data });
        const second = await request(f.client, '/passkeys/registration', authenticator().registration(enrollment.data));
        expect(second.status).toBe(201);
        expect((await request(f.client, '/passkeys/' + second.data.id, { currentPassword: password }, 'DELETE')).data.code).toBe('TOTP_INVALID');
        const removal = (await f.grant('passkey.remove:' + second.data.id, f.client, { counter: 5 })).data;
        expect((await request(f.client, '/passkeys/' + second.data.id, removal, 'DELETE')).status).toBe(200);
        expect(f.store.listPasskeys()).toHaveLength(1);
    });
    it('keeps passkey sign-in, fresh passkey proof and recovery available during a TOTP cooldown', async () => {
        const f = await fixture();
        const seed = await request(f.client, '/totp/setup', (await f.grant()).data);
        const code = new TOTP({ secret: Secret.fromBase32(seed.data.secret) }).generate();
        expect((await request(f.client, '/totp/confirm', { code })).status).toBe(200);
        for (let i = 0; i < 5; i++) expect((await request(f.client, '/totp', { currentPassword: f.account.password, totpCode: 'bad' }, 'DELETE')).data.code).toBe('TOTP_INVALID');
        const other = authClient(f.url);
        expect((await request(other, '/sessions', f.account)).data.code).toBe('TOTP_RATE_LIMITED');
        const options = await request(other, '/passkeys/authentication/options');
        expect((await request(other, '/passkeys/authentication', f.device.assertion(options.data, { counter: 2 }))).status).toBe(200);
        const password = randomBytes(24).toString('base64url');
        const proof = (await f.grant('password.change', f.client, { counter: 3 })).data;
        expect((await request(f.client, '/credentials', { ...proof, password }, 'PATCH')).status).toBe(200);
        expect((await request(authClient(f.url), '/sessions', { ...f.account, password })).data.code).toBe('TOTP_RATE_LIMITED');
        const replacement = randomBytes(24).toString('base64url');
        expect((await request(authClient(f.url), '/recovery', { recoveryKey: f.recoveryKey, password: replacement })).status).toBe(200);
        expect(f.store.isTotpEnabled()).toBe(false);
        expect((await request(authClient(f.url), '/sessions', { ...f.account, password: replacement })).data).toEqual({ ok: true });
    });
    it('does not let a grant to remove one passkey remove a different one', async () => {
        const f = await fixture();
        const options = await request(f.client, '/passkeys/registration/options', { name: 'Other', currentPassword: f.account.password });
        const second = await request(f.client, '/passkeys/registration', authenticator().registration(options.data));
        const proof = (await f.grant('passkey.remove:' + second.data.id)).data;
        expect((await request(f.client, '/passkeys/' + f.key.id, proof, 'DELETE')).data.code).toBe('REAUTH_INVALID');
        expect(f.store.listPasskeys()).toHaveLength(2);
    });
    it('rejects expired or reused reauthentication challenges and unsupported action names', async () => {
        const f = await fixture();
        expect((await request(f.client, '/passkeys/reauthentication/options', { action: 'token.create' })).data.code).toBe('VALIDATION_FAILED');
        const options = await request(f.client, '/passkeys/reauthentication/options', { action: 'totp.setup' });
        const response = f.device.assertion(options.data);
        f.advance(120001);
        expect((await request(f.client, '/passkeys/reauthentication', response)).data.code).toBe('PASSKEY_INVALID');
        expect((await request(f.client, '/passkeys/reauthentication', response)).data.code).toBe('PASSKEY_INVALID');
    });
});

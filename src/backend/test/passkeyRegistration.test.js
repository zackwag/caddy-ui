import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authClient, authFixture } from './fixtures/auth.mjs';
import { authenticator } from './fixtures/webauthn.mjs';

const fixtures = [];
const secret = () => randomBytes(24).toString('base64url');
const externalUrl = 'https://ui.example.com';
async function fixture(options = {}) {
    const f = await authFixture({ env: { CADDY_UI_EXTERNAL_URL: externalUrl }, ...options });
    fixtures.push(f);
    const client = authClient(f.url);
    const password = secret();
    const setup = await client.request('/auth/setup', { method: 'POST', body: { username: 'administrator', password } });
    expect(setup.status).toBe(200);
    return { ...f, client, password };
}
const optionsFor = (client, currentPassword, name = 'Laptop') => client.request('/auth/passkeys/registration/options', {
    method: 'POST', body: { name, currentPassword },
});
async function register(f, device = authenticator()) {
    const options = await optionsFor(f.client, f.password);
    expect(options.status).toBe(200);
    const response = device.registration(options.data);
    const result = await f.client.request('/auth/passkeys/registration', { method: 'POST', body: response });
    return { device, response, result };
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

describe('passkey enrollment and removal', () => {
    it('requires a management session, CSRF, HTTPS configuration and a fresh password for every enrollment', async () => {
        const f = await fixture();
        const anonymous = authClient(f.url);
        expect((await anonymous.request('/auth/passkeys')).status).toBe(401);
        expect((await optionsFor(anonymous, f.password)).status).toBe(401);
        expect((await f.client.request('/auth/passkeys/registration/options', { method: 'POST', csrf: false })).status).toBe(403);
        expect((await optionsFor(f.client, secret())).data.code).toBe('CURRENT_PASSWORD_INVALID');
        expect((await register(f)).result.status).toBe(201);
        expect((await optionsFor(f.client, undefined)).data.code).toBe('CURRENT_PASSWORD_INVALID');
        const http = await fixture({ env: { CADDY_UI_EXTERNAL_URL: 'http://ui.example.com' } });
        expect((await optionsFor(http.client, http.password)).data.code).toBe('PASSKEY_UNAVAILABLE');
        expect((await http.client.request('/auth/status')).data.passkeyOrigin).toBeNull();
        const unset = await fixture({ env: {} });
        expect((await optionsFor(unset.client, unset.password)).data.code).toBe('PASSKEY_UNAVAILABLE');
    });

    it('verifies real attestation and exposes only management metadata', async () => {
        const f = await fixture();
        const { result } = await register(f);
        expect(result.status).toBe(201);
        expect(result.data).toMatchObject({ name: 'Laptop', rpId: 'ui.example.com' });
        expect(result.data).not.toHaveProperty('publicKey');
        const listed = await f.client.request('/auth/passkeys');
        expect(listed.headers.get('cache-control')).toBe('no-store');
        expect(listed.data.passkeys).toEqual([result.data]);
        expect(listed.data.limit).toBe(3);
    });

    it('publishes the configured HTTPS origin without URL paths, queries or fragments', async () => {
        const f = await fixture({ env: { CADDY_UI_EXTERNAL_URL: externalUrl + '/ignored?setting=ignored#ignored' } });
        const state = await authClient(f.url).request('/auth/status');
        expect(state.status).toBe(200);
        expect(state.data.passkeyOrigin).toBe(externalUrl);
        expect(JSON.stringify(state.data)).not.toContain('ignored');
    });

    it.each(['https://192.168.1.10:8443', 'https://127.0.0.1', 'https://[::1]:8443', 'https://[::ffff:192.0.2.1]'])('disables passkeys for IP-literal external URLs (%s)', async externalUrl => {
        const f = await fixture({ env: { CADDY_UI_EXTERNAL_URL: externalUrl } });
        const state = (await f.client.request('/auth/status')).data;
        expect(state).toMatchObject({ passkeyOrigin: null, passkeyLoginAvailable: false, passkeyUnavailableReason: 'ip-address' });
        expect((await f.client.request('/auth/passkeys')).data).toMatchObject({ enabled: false, unavailableReason: 'ip-address' });
        expect((await optionsFor(f.client, f.password)).data.code).toBe('PASSKEY_IP_UNAVAILABLE');
        const anonymous = authClient(f.url);
        expect((await anonymous.request('/auth/passkeys/authentication/options', { method: 'POST' })).data.code).toBe('PASSKEY_IP_UNAVAILABLE');
    });

    it('checks public availability without cloning credential records', async () => {
        const f = await fixture();
        await register(f);
        const list = vi.spyOn(f.store, 'listPasskeys');
        expect((await authClient(f.url).request('/auth/status')).data.passkeyLoginAvailable).toBe(true);
        expect(list).not.toHaveBeenCalled();
    });

    it('classifies duplicate credentials rejected inside the store as invalid rather than a storage outage', async () => {
        const f = await fixture();
        const add = f.store.addPasskey.bind(f.store);
        vi.spyOn(f.store, 'addPasskey').mockImplementationOnce(async record => {
            await add(record);
            return add(record);
        });
        const { result } = await register(f);
        expect(result.status).toBe(400);
        expect(result.data.code).toBe('PASSKEY_INVALID');
        expect(f.store.listPasskeys()).toHaveLength(1);
    });

    it('denies scoped bearer tokens even when a valid management cookie accompanies the request', async () => {
        const f = await fixture();
        const token = await f.store.issueApiToken({ name: 'Automation', scopes: ['status:read'], instanceIds: ['default'], expiresInDays: 30 });
        const headers = { Authorization: 'Bearer ' + token.token };
        expect((await f.client.request('/auth/passkeys', { headers })).status).toBe(403);
        expect((await f.client.request('/auth/passkeys/registration/options', { method: 'POST', headers,
            body: { name: 'Laptop', currentPassword: f.password } })).status).toBe(403);
        expect(f.store.listPasskeys()).toEqual([]);
    });

    it('invalidates an earlier registration authorization when a new password check fails', async () => {
        const f = await fixture();
        const options = await optionsFor(f.client, f.password);
        const response = authenticator().registration(options.data);
        expect((await optionsFor(f.client, secret())).status).toBe(403);
        expect((await f.client.request('/auth/passkeys/registration', { method: 'POST', body: response })).data.code).toBe('PASSKEY_INVALID');
    });

    it('rejects wrong origins, RP IDs, missing user verification and malformed attestation', async () => {
        const f = await fixture();
        for (const mutation of [{ origin: 'https://evil.example.com' }, { rpId: 'evil.example.com' }, { verified: false }, { crossOrigin: true }]) {
            const options = await optionsFor(f.client, f.password);
            const response = authenticator().registration(options.data, mutation);
            expect((await f.client.request('/auth/passkeys/registration', { method: 'POST', body: response })).data.code).toBe('PASSKEY_INVALID');
        }
        await optionsFor(f.client, f.password);
        expect((await f.client.request('/auth/passkeys/registration', { method: 'POST', body: {} })).data.code).toBe('PASSKEY_INVALID');
        expect(f.store.listPasskeys()).toEqual([]);
    });

    it('rejects invalid transport metadata before persistence and keeps valid enrollment usable', async () => {
        const f = await fixture();
        const add = vi.spyOn(f.store, 'addPasskey');
        for (const transports of ['internal', {}, [7], ['x'.repeat(33)], Array(9).fill('internal')]) {
            const options = await optionsFor(f.client, f.password);
            const response = authenticator().registration(options.data);
            response.response.transports = transports;
            const before = await readFile(f.path, 'utf8');
            const result = await f.client.request('/auth/passkeys/registration', { method: 'POST', body: response });
            expect(result.status).toBe(400);
            expect(result.data.code).toBe('PASSKEY_INVALID');
            expect(add).not.toHaveBeenCalled();
            expect(await readFile(f.path, 'utf8')).toBe(before);
        }
        expect(f.store.listPasskeys()).toEqual([]);
        expect((await f.client.request('/protected')).status).toBe(200);
        expect((await register(f)).result.status).toBe(201);
        expect(add).toHaveBeenCalledOnce();
    });

    it('binds challenges to the initiating session, expires them and consumes them once', async () => {
        let time = Date.now();
        const f = await fixture({ now: () => time });
        const other = authClient(f.url);
        await other.request('/auth/sessions', { method: 'POST', body: { username: 'administrator', password: f.password } });
        const options = await optionsFor(f.client, f.password);
        const response = authenticator().registration(options.data);
        expect((await other.request('/auth/passkeys/registration', { method: 'POST', body: response })).data.code).toBe('PASSKEY_INVALID');
        expect((await f.client.request('/auth/passkeys/registration', { method: 'POST', body: response })).status).toBe(201);
        expect((await f.client.request('/auth/passkeys/registration', { method: 'POST', body: response })).data.code).toBe('PASSKEY_INVALID');
        const expired = await optionsFor(f.client, f.password);
        time += 120001;
        expect((await f.client.request('/auth/passkeys/registration', { method: 'POST', body: authenticator().registration(expired.data) })).data.code).toBe('PASSKEY_INVALID');
    });

    it('checks the limit again when concurrent pending enrollments finish', async () => {
        const f = await fixture();
        await register(f);
        await register(f);
        const other = authClient(f.url);
        await other.request('/auth/sessions', { method: 'POST', body: { username: 'administrator', password: f.password } });
        const a = await optionsFor(f.client, f.password);
        const b = await optionsFor(other, f.password);
        const results = await Promise.all([f.client.request('/auth/passkeys/registration', { method: 'POST', body: authenticator().registration(a.data) }),
            other.request('/auth/passkeys/registration', { method: 'POST', body: authenticator().registration(b.data) })]);
        expect(results.map(result => result.status).sort()).toEqual([201, 409]);
        expect((await optionsFor(f.client, f.password)).data.code).toBe('PASSKEY_LIMIT');
        expect(f.store.listPasskeys()).toHaveLength(3);
    });

    it('requires a fresh password for every removal, including a session opened with a lost passkey', async () => {
        const f = await fixture();
        const { device, result: { data: first } } = await register(f);
        const second = (await register(f)).result.data;
        const other = authClient(f.url);
        const options = await other.request('/auth/passkeys/authentication/options', { method: 'POST' });
        expect((await other.request('/auth/passkeys/authentication', { method: 'POST', body: device.assertion(options.data) })).status).toBe(200);
        const before = await readFile(f.path, 'utf8');
        for (const currentPassword of [undefined, secret()]) {
            expect((await other.request('/auth/passkeys/' + second.id, { method: 'DELETE', body: { currentPassword } })).data.code).toBe('CURRENT_PASSWORD_INVALID');
        }
        expect(await readFile(f.path, 'utf8')).toBe(before);
        expect((await other.request('/protected')).status).toBe(200);
        expect((await f.client.request('/protected')).status).toBe(200);
        const oldCookie = f.client.cookie;
        expect((await f.client.request('/auth/passkeys/' + first.id, { method: 'DELETE', body: { currentPassword: f.password } })).status).toBe(200);
        expect(f.client.cookie).not.toBe(oldCookie);
        expect((await other.request('/protected')).status).toBe(401);
        expect((await f.client.request('/auth/passkeys/' + second.id, { method: 'DELETE' })).data.code).toBe('CURRENT_PASSWORD_INVALID');
        expect((await f.client.request('/protected')).status).toBe(200);
        expect((await f.client.request('/auth/passkeys/' + second.id, { method: 'DELETE', body: { currentPassword: f.password } })).status).toBe(200);
        expect(f.store.listPasskeys()).toEqual([]);
    });

    it('keeps passkeys and sessions when persistence fails and consumes the attempted challenge', async () => {
        const f = await fixture();
        const options = await optionsFor(f.client, f.password);
        const response = authenticator().registration(options.data);
        await rename(f.path, f.path + '.saved');
        await mkdir(f.path);
        expect((await f.client.request('/auth/passkeys/registration', { method: 'POST', body: response })).data.code).toBe('AUTH_PERSISTENCE_FAILED');
        expect(f.store.listPasskeys()).toEqual([]);
        expect((await f.client.request('/protected')).status).toBe(200);
        await rm(f.path, { recursive: true });
        await rename(f.path + '.saved', f.path);
        expect((await f.client.request('/auth/passkeys/registration', { method: 'POST', body: response })).data.code).toBe('PASSKEY_INVALID');
        expect((await register(f)).result.status).toBe(201);
    });
});

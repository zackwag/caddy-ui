import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthStore } from '../src/authStore.js';
import { authClient, authFixture } from './fixtures/auth.mjs';
import { authenticator } from './fixtures/webauthn.mjs';

const fixtures = [];
const secret = () => randomBytes(24).toString('base64url');
const env = { CADDY_UI_EXTERNAL_URL: 'https://ui.example.com' };
async function fixture() {
    const f = await authFixture({ env });
    fixtures.push(f);
    const client = authClient(f.url);
    const password = secret();
    const setup = await client.request('/auth/setup', { method: 'POST', body: { username: 'administrator', password } });
    const options = await client.request('/auth/passkeys/registration/options', { method: 'POST', body: { name: 'Laptop', currentPassword: password } });
    const device = authenticator();
    const registration = await client.request('/auth/passkeys/registration', { method: 'POST', body: device.registration(options.data) });
    expect(registration.status).toBe(201);
    return { ...f, client, password, device, id: registration.data.id, recoveryKey: setup.data.recoveryKey };
}
const optionsFor = client => client.request('/auth/passkeys/authentication/options', { method: 'POST' });
const submit = (client, body) => client.request('/auth/passkeys/authentication', { method: 'POST', body });
afterEach(async () => { for (const f of fixtures.splice(0).reverse()) await f.close(); });

describe('passkey sign-in', () => {
    it('classifies a counter rejected inside the store as invalid and does not issue a session', async () => {
        const f = await fixture();
        const client = authClient(f.url);
        const update = f.store.updatePasskeyUsage.bind(f.store);
        vi.spyOn(f.store, 'updatePasskeyUsage').mockImplementationOnce(async (id, info) => {
            await update(id, { ...info, newCounter: 5 });
            return update(id, info);
        });
        const options = await optionsFor(client);
        const result = await submit(client, f.device.assertion(options.data));
        expect(result.status).toBe(400);
        expect(result.data.code).toBe('PASSKEY_INVALID');
        expect((await client.request('/protected')).status).toBe(401);
        expect(f.store.listPasskeys()[0].counter).toBe(5);
    });
    it('verifies a signed assertion after reloading storage, persists counters and renews the anonymous context', async () => {
        const f = await fixture();
        const restarted = await authFixture({ env, store: createAuthStore(f.path) });
        fixtures.push(restarted);
        const client = authClient(restarted.url);
        const options = await optionsFor(client);
        expect(options.data.userVerification).toBe('required');
        expect(options.data.allowCredentials || []).toEqual([]);
        const before = client.cookie;
        expect((await submit(client, f.device.assertion(options.data))).status).toBe(200);
        expect(client.cookie).not.toBe(before);
        expect((await client.request('/protected', { method: 'PUT' })).status).toBe(200);
        const loaded = createAuthStore(f.path);
        await loaded.loadAuth();
        expect(loaded.listPasskeys()[0]).toMatchObject({ counter: 1, lastUsedAt: expect.any(String) });
        expect((await client.request('/auth/status')).data.authenticated).toBe(true);
    });

    it('rejects forged signatures, origins, RP IDs, account handles, missing UV and embedded responses', async () => {
        const f = await fixture();
        const client = authClient(f.url);
        for (const mutation of [{ origin: 'https://evil.example.com' }, { rpId: 'evil.example.com' },
            { userHandle: secret() }, { verified: false }, { crossOrigin: true }]) {
            const options = await optionsFor(client);
            expect((await submit(client, f.device.assertion(options.data, mutation))).data.code).toBe('PASSKEY_INVALID');
        }
        const options = await optionsFor(client);
        const forged = f.device.assertion(options.data);
        forged.response.signature = secret();
        expect((await submit(client, forged)).data.code).toBe('PASSKEY_INVALID');
        expect((await client.request('/protected')).status).toBe(401);
    });

    it('binds login challenges to one session and rejects replay and stale counters', async () => {
        const f = await fixture();
        const a = authClient(f.url);
        const b = authClient(f.url);
        const options = await optionsFor(a);
        const response = f.device.assertion(options.data);
        await optionsFor(b);
        expect((await submit(b, response)).data.code).toBe('PASSKEY_INVALID');
        expect((await submit(a, response)).status).toBe(200);
        expect((await submit(a, response)).data.code).toBe('PASSKEY_INVALID');
        const next = await optionsFor(b);
        expect((await submit(b, f.device.assertion(next.data))).data.code).toBe('PASSKEY_INVALID');
        const retry = await optionsFor(b);
        expect((await submit(b, f.device.assertion(retry.data, { counter: 2 }))).status).toBe(200);
    });

    it('rejects an expired sign-in challenge without granting a management session', async () => {
        const f = await fixture();
        let time = Date.now();
        const isolated = await authFixture({ env, now: () => time, store: createAuthStore(f.path) });
        fixtures.push(isolated);
        const client = authClient(isolated.url);
        const options = await optionsFor(client);
        time += 120001;
        expect((await submit(client, f.device.assertion(options.data))).data.code).toBe('PASSKEY_INVALID');
        expect((await client.request('/protected')).status).toBe(401);
    });

    it('does not issue a session if counter persistence fails', async () => {
        const f = await fixture();
        const client = authClient(f.url);
        const options = await optionsFor(client);
        await rename(f.path, f.path + '.saved');
        await mkdir(f.path);
        expect((await submit(client, f.device.assertion(options.data))).data.code).toBe('AUTH_PERSISTENCE_FAILED');
        expect((await client.request('/protected')).status).toBe(401);
        expect(f.store.listPasskeys()[0].counter).toBe(0);
        await rm(f.path, { recursive: true });
        await rename(f.path + '.saved', f.path);
        const retry = await optionsFor(client);
        expect((await submit(client, f.device.assertion(retry.data))).status).toBe(200);
    });

    it('rejects a removed passkey even when its login challenge was issued before removal', async () => {
        const f = await fixture();
        const client = authClient(f.url);
        const options = await optionsFor(client);
        await f.client.request('/auth/passkeys/' + f.id, { method: 'DELETE', body: { currentPassword: f.password } });
        expect((await submit(client, f.device.assertion(options.data))).status).not.toBe(200);
        expect((await client.request('/protected')).status).toBe(401);
        expect((await f.client.request('/auth/status')).data.passkeyLoginAvailable).toBe(false);
    });

    it('removes passkeys on recovery while preserving password sign-in as a fallback', async () => {
        const f = await fixture();
        const password = secret();
        const client = authClient(f.url);
        expect((await client.request('/auth/recovery', { method: 'POST', body: { recoveryKey: f.recoveryKey, password } })).status).toBe(200);
        expect(f.store.listPasskeys()).toEqual([]);
        expect((await client.request('/auth/sessions', { method: 'POST', body: { username: 'administrator', password } })).status).toBe(200);
    });
});

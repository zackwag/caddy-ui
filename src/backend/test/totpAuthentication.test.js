import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Secret, TOTP } from 'otpauth';
import { authClient, authFixture } from './fixtures/auth.mjs';
import { createAuthStore } from '../src/authStore.js';
import { recordAuthentication } from '../src/authEvents.js';

vi.mock('../src/authEvents.js', () => ({ recordAuthentication: vi.fn() }));
const fixtures = [];
const credentials = () => ({ username: 'admin', password: randomBytes(24).toString('base64url') });
const request = (client, path, body, method = 'POST') => client.request('/auth' + path, { method, body });
async function fixture(env = {}) {
    let time = 1792600010000;
    const f = await authFixture({ env, now: () => time });
    fixtures.push(f);
    const client = authClient(f.url);
    const account = credentials();
    const setup = await request(client, '/setup', account);
    expect(setup.status).toBe(200);
    const start = () => request(client, '/totp/setup', { currentPassword: account.password });
    const code = (secret, offset = 0) => new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp: time + offset * 30000 });
    async function enable() {
        const setup = await start();
        expect(setup.status).toBe(200);
        expect((await request(client, '/totp/confirm', { code: code(setup.data.secret) })).status).toBe(200);
        time += 30000;
        return setup.data.secret;
    }
    return { ...f, client, account, now: () => time, recoveryKey: setup.data.recoveryKey, start, code, enable, advance: ms => { time += ms; } };
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); vi.clearAllMocks(); });

describe('TOTP enrollment and password sign-in', () => {
    it.each([{}, { CADDY_UI_EXTERNAL_URL: 'https://ui.example.com' }])('confirms enrollment over HTTP/HTTPS configuration, never exposes the seed in status, and persists it', async env => {
        const f = await fixture(env);
        expect((await authClient(f.url).request('/auth/totp/setup', { method: 'POST', body: { currentPassword: f.account.password } })).status).toBe(401);
        expect((await request(f.client, '/totp/setup', {})).data.code).toBe('CURRENT_PASSWORD_INVALID');
        expect((await f.client.request('/auth/totp/setup', { method: 'POST', csrf: false })).status).toBe(403);
        const setup = await f.start();
        expect(setup.headers.get('cache-control')).toBe('no-store');
        expect(f.store.isTotpEnabled()).toBe(false);
        expect((await request(f.client, '/totp/confirm', { code: 'bad' })).data.code).toBe('TOTP_INVALID');
        expect((await request(f.client, '/totp/confirm', { code: f.code(setup.data.secret) })).status).toBe(200);
        const state = await f.client.request('/auth/status');
        expect(state.data).toMatchObject({ authenticated: true, totpEnabled: true });
        expect(JSON.stringify(state.data)).not.toContain(setup.data.secret);
        expect((await f.client.request('/auth/credentials')).data).not.toHaveProperty('totp');
        const restarted = createAuthStore(f.path);
        await restarted.loadAuth();
        expect(restarted.isTotpEnabled()).toBe(true);
    });
    it('keeps password-only sessions restricted until the code is checked, rotating cookie and CSRF', async () => {
        const f = await fixture();
        const seed = await f.enable();
        const client = authClient(f.url);
        vi.clearAllMocks();
        const login = await request(client, '/sessions', f.account);
        expect(login.data).toEqual({ ok: true, totpRequired: true });
        expect(recordAuthentication).not.toHaveBeenCalled();
        expect((await client.request('/auth/status')).data).toMatchObject({ authenticated: false, totpPending: true });
        for (const path of ['/protected', '/auth/credentials', '/auth/passkeys', '/auth/tokens']) expect((await client.request(path)).status).toBe(401);
        expect((await request(client, '/tokens', {})).status).toBe(401);
        expect((await request(client, '/totp/setup', { currentPassword: f.account.password })).status).toBe(401);
        const cookie = client.cookie;
        const csrf = (await client.request('/auth/csrf')).data.csrfToken;
        expect((await client.request('/auth/sessions/totp', { method: 'POST', csrf: false, body: { code: f.code(seed) } })).status).toBe(403);
        expect((await request(client, '/sessions/totp', { code: f.code(seed) })).status).toBe(200);
        expect(client.cookie).not.toBe(cookie);
        expect((await client.request('/protected')).status).toBe(200);
        expect((await client.request('/protected', { method: 'PUT', headers: { 'X-CSRF-Token': csrf } })).status).toBe(403);
        expect(recordAuthentication).toHaveBeenCalledWith(expect.anything(), 'password-totp', 'success', false);
        expect((await request(authClient(f.url), '/sessions/totp', { code: f.code(seed) })).status).toBe(401);
    });
    it('rejects reused codes and expires pending sign-in after five attempts or five minutes', async () => {
        const f = await fixture();
        const seed = await f.enable();
        const client = authClient(f.url);
        await request(client, '/sessions', f.account);
        for (let i = 0; i < 5; i++) expect((await request(client, '/sessions/totp', { code: 'bad' })).data.code)
            .toBe(i === 4 ? 'TOTP_CHALLENGE_EXPIRED' : 'TOTP_INVALID');
        expect((await request(client, '/sessions/totp', { code: f.code(seed) })).status).toBe(401);
        const blocked = await request(client, '/sessions', f.account);
        expect(blocked.status).toBe(429);
        expect(blocked.data.code).toBe('TOTP_RATE_LIMITED');
        f.advance(300000);
        expect((await request(client, '/sessions', f.account)).status).toBe(200);
        f.advance(300001);
        expect((await request(client, '/sessions/totp', { code: f.code(seed) })).data.code).toBe('TOTP_CHALLENGE_EXPIRED');
        await request(client, '/sessions', f.account);
        expect((await request(client, '/sessions/totp', { code: f.code(seed) })).status).toBe(200);
        await request(client, '/sessions', f.account);
        expect((await request(client, '/sessions/totp', { code: f.code(seed) })).data.code).toBe('TOTP_INVALID');
        expect((await client.request('/protected')).status).toBe(401);
    });
    it('shares a bounded cooldown across fresh challenges, without extending it on blocked requests', async () => {
        const f = await fixture();
        const seed = await f.enable();
        for (let i = 0; i < 5; i++) {
            const client = authClient(f.url);
            expect((await request(client, '/sessions', f.account)).data.totpRequired).toBe(true);
            expect((await request(client, '/sessions/totp', { code: 'bad' })).data.code).toBe('TOTP_INVALID');
        }
        const other = authClient(f.url);
        const blocked = await request(other, '/sessions', f.account);
        expect(blocked.status).toBe(429);
        expect(blocked.data.code).toBe('TOTP_RATE_LIMITED');
        expect(blocked.headers.get('retry-after')).toBe('300');
        const before = await readFile(f.path, 'utf8');
        f.advance(60000);
        for (let i = 0; i < 3; i++) {
            const repeated = await request(authClient(f.url), '/sessions', f.account);
            expect(repeated.headers.get('retry-after')).toBe('240');
        }
        expect(await readFile(f.path, 'utf8')).toBe(before);
        expect((await f.client.request('/protected')).status).toBe(200);
        f.advance(240000);
        expect((await request(other, '/sessions', f.account)).status).toBe(200);
        expect((await request(other, '/sessions/totp', { code: f.code(seed) })).status).toBe(200);
        expect(JSON.parse(await readFile(f.path, 'utf8')).totp.failures.count).toBe(0);
    });
    it('caps concurrent guesses across independent pending sessions, including already-created challenges', async () => {
        const f = await fixture();
        const seed = await f.enable();
        const clients = Array.from({ length: 7 }, () => authClient(f.url));
        await Promise.all(clients.map(client => request(client, '/sessions', f.account)));
        const results = await Promise.all(clients.map(client => request(client, '/sessions/totp', { code: 'bad' })));
        expect(results.filter(result => result.data.code === 'TOTP_INVALID')).toHaveLength(5);
        expect(results.filter(result => result.data.code === 'TOTP_RATE_LIMITED')).toHaveLength(2);
        expect(JSON.parse(await readFile(f.path, 'utf8')).totp.failures.count).toBe(5);
        expect((await request(clients[0], '/sessions/totp', { code: f.code(seed) })).data.code).toBe('TOTP_RATE_LIMITED');
        expect((await clients[0].request('/protected')).status).toBe(401);
    });
    it('shares the budget with credential reauthentication and preserves it through username changes', async () => {
        const f = await fixture();
        const seed = await f.enable();
        const proof = { currentPassword: f.account.password, totpCode: 'bad' };
        expect((await request(f.client, '/totp/setup', proof)).data.code).toBe('TOTP_INVALID');
        expect((await request(f.client, '/totp', proof, 'DELETE')).data.code).toBe('TOTP_INVALID');
        const client = authClient(f.url);
        await request(client, '/sessions', f.account);
        for (let i = 0; i < 3; i++) expect((await request(client, '/sessions/totp', { code: 'bad' })).data.code).toBe('TOTP_INVALID');
        const change = { currentPassword: f.account.password, password: credentials().password, totpCode: f.code(seed) };
        expect((await request(f.client, '/credentials', change, 'PATCH')).data.code).toBe('TOTP_RATE_LIMITED');
        expect((await request(f.client, '/credentials', { currentPassword: f.account.password, username: 'renamed' }, 'PATCH')).status).toBe(200);
        expect((await request(f.client, '/credentials', change, 'PATCH')).data.code).toBe('TOTP_RATE_LIMITED');
        expect(JSON.parse(await readFile(f.path, 'utf8')).totp.failures.count).toBe(5);
    });
    it('retains the account cooldown across backend/store restarts', async () => {
        const f = await fixture();
        const seed = await f.enable();
        const client = authClient(f.url);
        await request(client, '/sessions', f.account);
        for (let i = 0; i < 5; i++) await request(client, '/sessions/totp', { code: 'bad' });
        const restarted = await authFixture({ store: createAuthStore(f.path, { now: f.now }), now: f.now });
        fixtures.push(restarted);
        const other = authClient(restarted.url);
        expect((await request(other, '/sessions', f.account)).data.code).toBe('TOTP_RATE_LIMITED');
        f.advance(300000);
        expect((await request(other, '/sessions', f.account)).status).toBe(200);
        expect((await request(other, '/sessions/totp', { code: f.code(seed) })).status).toBe(200);
    });
    it('does not let anonymous requests or wrong passwords consume the TOTP budget', async () => {
        const f = await fixture();
        const seed = await f.enable();
        const client = authClient(f.url);
        for (let i = 0; i < 6; i++) {
            expect((await request(client, '/sessions/totp', { code: 'bad' })).status).toBe(401);
            expect((await request(client, '/sessions', { ...f.account, password: 'wrong' })).status).toBe(401);
            expect((await request(f.client, '/credentials', { currentPassword: 'wrong', password: credentials().password }, 'PATCH')).data.code).toBe('CURRENT_PASSWORD_INVALID');
        }
        expect(JSON.parse(await readFile(f.path, 'utf8')).totp.failures).toBeUndefined();
        await request(client, '/sessions', f.account);
        expect((await request(client, '/sessions/totp', { code: f.code(seed) })).status).toBe(200);
    });
    it('expires/cancels proposed seeds and keeps the old enrollment active during replacement', async () => {
        const f = await fixture();
        const first = await f.start();
        await request(f.client, '/totp/setup', undefined, 'DELETE');
        expect((await request(f.client, '/totp/confirm', { code: f.code(first.data.secret) })).data.code).toBe('TOTP_SETUP_EXPIRED');
        const expiring = await f.start();
        f.advance(300001);
        expect((await request(f.client, '/totp/confirm', { code: f.code(expiring.data.secret) })).data.code).toBe('TOTP_SETUP_EXPIRED');
        const seed = await f.enable();
        const next = await request(f.client, '/totp/setup', { currentPassword: f.account.password, totpCode: f.code(seed) });
        expect(next.status).toBe(200);
        expect(JSON.parse(await readFile(f.path, 'utf8')).totp.secret).toBe(seed);
        expect((await request(f.client, '/totp/confirm', { code: f.code(next.data.secret) })).status).toBe(200);
        expect(JSON.parse(await readFile(f.path, 'utf8')).totp.secret).toBe(next.data.secret);
    });
    it('protects password/passkey changes with TOTP, while username changes keep the password check', async () => {
        const f = await fixture({ CADDY_UI_EXTERNAL_URL: 'https://ui.example.com' });
        const seed = await f.enable();
        expect((await request(f.client, '/credentials', { currentPassword: f.account.password, password: credentials().password }, 'PATCH')).data.code).toBe('TOTP_INVALID');
        expect((await request(f.client, '/passkeys/registration/options', { name: 'Phone', currentPassword: f.account.password })).data.code).toBe('TOTP_INVALID');
        expect((await request(f.client, '/credentials', { currentPassword: f.account.password, username: 'renamed' }, 'PATCH')).status).toBe(200);
        expect((await request(f.client, '/totp', { currentPassword: f.account.password }, 'DELETE')).data.code).toBe('TOTP_INVALID');
        const password = credentials().password;
        expect((await request(f.client, '/credentials', { currentPassword: f.account.password, totpCode: f.code(seed), password }, 'PATCH')).status).toBe(200);
        expect(await f.store.verifyPassword('renamed', password)).toBe(true);
        expect(f.store.isTotpEnabled()).toBe(true);
    });
    it('revokes other sessions at enrollment/disable and leaves the verified caller signed in', async () => {
        const f = await fixture();
        const other = authClient(f.url);
        await request(other, '/sessions', f.account);
        const seed = await f.enable();
        expect((await other.request('/protected')).status).toBe(401);
        await request(other, '/sessions', f.account);
        expect((await request(f.client, '/totp', { currentPassword: f.account.password, totpCode: f.code(seed) }, 'DELETE')).status).toBe(200);
        expect(f.store.isTotpEnabled()).toBe(false);
        expect(JSON.parse(await readFile(f.path, 'utf8')).version).toBe(1);
        expect((await other.request('/auth/status')).data.totpPending).toBe(false);
        expect((await f.client.request('/protected')).status).toBe(200);
        expect((await request(other, '/sessions', f.account)).data).toEqual({ ok: true });
    });
    it('does not grant a session when persisting replay protection fails, and allows retry after repair', async () => {
        const f = await fixture();
        const seed = await f.enable();
        const client = authClient(f.url);
        await request(client, '/sessions', f.account);
        await rename(f.path, f.path + '.saved');
        await mkdir(f.path);
        expect((await request(client, '/sessions/totp', { code: f.code(seed) })).data.code).toBe('AUTH_PERSISTENCE_FAILED');
        expect((await client.request('/protected')).status).toBe(401);
        await rm(f.path, { recursive: true });
        await rename(f.path + '.saved', f.path);
        expect((await request(client, '/sessions/totp', { code: f.code(seed) })).status).toBe(200);
    });
    it('recovery disables TOTP and revokes existing management and pending sessions', async () => {
        const f = await fixture();
        await f.enable();
        const other = authClient(f.url);
        await request(other, '/sessions', f.account);
        const replacement = credentials();
        expect((await request(authClient(f.url), '/recovery', { recoveryKey: f.recoveryKey, password: replacement.password })).status).toBe(200);
        expect(f.store.isTotpEnabled()).toBe(false);
        expect((await f.client.request('/protected')).status).toBe(401);
        expect((await other.request('/auth/status')).data.totpPending).toBe(false);
        expect((await request(other, '/sessions', { ...f.account, password: replacement.password })).data).toEqual({ ok: true });
    });
});

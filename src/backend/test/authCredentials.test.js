import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authClient, authFixture } from './fixtures/auth.mjs';
import { createAuthStore } from '../src/authStore.js';

vi.mock('../src/instances.js', async importOriginal => ({ ...await importOriginal(), getInstances: () => [{ id: 'alpha', name: 'Main', adminUrl: 'http://caddy:2019',
    configPath: '/etc/caddy/Caddyfile', logPath: '/var/log/caddy/access.log', dataPath: '/data/caddy', containerName: 'caddy', serverName: 'srv0' }] }));
const fixtures = [];
const secret = () => randomBytes(24).toString('base64url');
const tokenInput = { name: 'Automation', scopes: ['status:read'], instanceIds: ['alpha'], expiresInDays: 30 };

async function fixture(options) {
    const f = await authFixture(options);
    fixtures.push(f);
    return f;
}
async function enrolled() {
    const f = await fixture();
    const client = authClient(f.url);
    const credentials = { username: 'administrator', password: secret() };
    const setup = await client.request('/auth/setup', { method: 'POST', body: credentials });
    expect(setup.status).toBe(200);
    return { ...f, client, credentials, recoveryKey: setup.data.recoveryKey };
}
const change = (client, body, options = {}) => client.request('/auth/credentials', { method: 'PATCH', body, ...options });
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

describe('administrator credential changes', () => {
    it('requires a management session and CSRF, without revealing the username publicly', async () => {
        const { url, client, credentials } = await enrolled();
        const anonymous = authClient(url);
        const profile = await anonymous.request('/auth/credentials');
        expect(profile.status).toBe(401);
        expect(profile.data).not.toHaveProperty('username');
        expect((await change(anonymous, { currentPassword: credentials.password, username: 'other' })).status).toBe(401);
        expect((await change(client, { currentPassword: credentials.password, username: 'other' }, { csrf: false })).status).toBe(403);
        expect((await change(client, { currentPassword: credentials.password, username: 'other' },
            { headers: { Origin: 'https://attacker.example' } })).status).toBe(403);
        const current = await client.request('/auth/credentials');
        expect(current.data).toEqual({ username: credentials.username });
        expect(current.headers.get('cache-control')).toBe('no-store');
    });

    it('does not grant credential management to an enrollment session', async () => {
        const env = { CADDY_UI_USER: 'legacy', CADDY_UI_PASSWORD: secret(), JWT_SECRET: secret() };
        const { url } = await fixture({ env });
        const client = authClient(url);
        expect((await client.request('/auth/sessions', { method: 'POST', body: { username: env.CADDY_UI_USER, password: env.CADDY_UI_PASSWORD } })).status).toBe(200);
        expect((await client.request('/auth/credentials')).status).toBe(401);
        expect((await change(client, { currentPassword: env.CADDY_UI_PASSWORD, username: 'renamed' })).status).toBe(401);
    });

    it('requires the current password without signing out a valid session on failure', async () => {
        const { client, store, credentials } = await enrolled();
        const cookie = client.cookie;
        const result = await change(client, { currentPassword: secret(), username: 'other', password: secret() });
        expect(result.status).toBe(403);
        expect(result.data.code).toBe('CURRENT_PASSWORD_INVALID');
        expect(client.cookie).toBe(cookie);
        expect((await client.request('/protected')).status).toBe(200);
        expect(await store.verifyPassword(credentials.username, credentials.password)).toBe(true);
    });

    it('updates only the username, renews this session/CSRF and closes all old sessions and streams', async () => {
        const { url, client, credentials } = await enrolled();
        const other = authClient(url);
        expect((await other.request('/auth/sessions', { method: 'POST', body: credentials })).status).toBe(200);
        const previousCookie = client.cookie;
        const previousCsrf = (await client.request('/auth/csrf')).data.csrfToken;
        const stream = await fetch(url + '/api/stream', { headers: { cookie: client.cookie } });
        const reader = stream.body.getReader();
        await reader.read();
        const result = await change(client, { currentPassword: credentials.password, username: 'renamed' });
        expect(result.status).toBe(200);
        expect(result.data).toEqual({ username: 'renamed' });
        expect(result.headers.get('cache-control')).toBe('no-store');
        expect(client.cookie).not.toBe(previousCookie);
        expect((await reader.read()).done).toBe(true);
        expect((await other.request('/protected')).status).toBe(401);
        expect((await fetch(url + '/api/protected', { headers: { cookie: previousCookie } })).status).toBe(401);
        expect((await client.request('/protected', { method: 'PUT', headers: { 'X-CSRF-Token': previousCsrf } })).status).toBe(403);
        expect((await client.request('/protected', { method: 'PUT' })).status).toBe(200);
        expect((await other.request('/auth/sessions', { method: 'POST', body: credentials })).status).toBe(401);
        expect((await other.request('/auth/sessions', { method: 'POST', body: { username: 'renamed', password: credentials.password } })).status).toBe(200);
    });

    it('persists username/password changes across restart while preserving API tokens and the recovery key', async () => {
        const { url, path, client, credentials, recoveryKey } = await enrolled();
        const token = (await client.request('/auth/tokens', { method: 'POST', body: tokenInput })).data;
        const before = JSON.parse(await readFile(path, 'utf8'));
        const username = 'new-admin';
        const password = secret();
        expect((await change(client, { currentPassword: credentials.password, username, password })).status).toBe(200);
        const restarted = createAuthStore(path);
        await restarted.loadAuth();
        expect(await restarted.verifyPassword(username, password)).toBe(true);
        expect(await restarted.verifyPassword(credentials.username, credentials.password)).toBe(false);
        const raw = await readFile(path, 'utf8');
        expect(raw).not.toContain(password);
        expect(raw).not.toContain(credentials.password);
        expect(JSON.parse(raw).recovery).toEqual(before.recovery);
        expect((await client.request('/auth/tokens')).data.tokens.map(item => item.id)).toEqual([token.id]);
        expect((await fetch(url + '/api/status', { headers: { Authorization: 'Bearer ' + token.token } })).status).toBe(200);
        const anonymous = authClient(url);
        expect((await anonymous.request('/auth/recovery', { method: 'POST', body: { recoveryKey, password: secret() } })).status).toBe(200);
    });

    it('allows password-only changes and rejects credential management with a scoped bearer token', async () => {
        const { client, credentials } = await enrolled();
        const token = (await client.request('/auth/tokens', { method: 'POST', body: tokenInput })).data.token;
        const headers = { Authorization: 'Bearer ' + token };
        expect((await client.request('/auth/credentials', { headers })).status).toBe(403);
        const password = secret();
        expect((await change(client, { currentPassword: credentials.password, password }, { headers })).status).toBe(403);
        expect((await change(client, { currentPassword: credentials.password, password })).status).toBe(200);
        expect((await client.request('/auth/credentials')).data.username).toBe(credentials.username);
    });

    it('rejects malformed updates and invalid credentials without changing the account', async () => {
        const { client, credentials, store } = await enrolled();
        for (const body of [null, [], {}, { username: 'renamed' },
            { currentPassword: credentials.password }, { currentPassword: credentials.password, username: '' },
            { currentPassword: credentials.password, username: 'x'.repeat(129) },
            { currentPassword: credentials.password, password: 'short' },
            { currentPassword: credentials.password, password: 'é'.repeat(513) }]) {
            expect((await change(client, body)).status).toBe(400);
        }
        expect(await store.verifyPassword(credentials.username, credentials.password)).toBe(true);
        expect((await client.request('/protected')).status).toBe(200);
    });

    it('preserves existing credentials, sessions, tokens and recovery when persistence fails, then permits retry', async () => {
        const { path, client, credentials, store } = await enrolled();
        const token = (await client.request('/auth/tokens', { method: 'POST', body: tokenInput })).data;
        const cookie = client.cookie;
        const original = await readFile(path, 'utf8');
        await rename(path, path + '.saved');
        await mkdir(path);
        const body = { currentPassword: credentials.password, username: 'renamed', password: secret() };
        expect((await change(client, body)).status).toBe(503);
        expect(client.cookie).toBe(cookie);
        expect((await client.request('/protected')).status).toBe(200);
        expect(await store.verifyPassword(credentials.username, credentials.password)).toBe(true);
        expect(store.listApiTokens().map(item => item.id)).toEqual([token.id]);
        expect(await readFile(path + '.saved', 'utf8')).toBe(original);
        await rm(path, { recursive: true });
        await rename(path + '.saved', path);
        expect((await change(client, body)).status).toBe(200);
    });

    it('rechecks authorization for queued changes after the first update revokes old sessions', async () => {
        const { url, client, credentials, store } = await enrolled();
        const other = authClient(url);
        await other.request('/auth/sessions', { method: 'POST', body: credentials });
        const body = { currentPassword: credentials.password, username: 'winner' };
        const results = await Promise.all([change(client, body), change(other, { ...body, username: 'loser' })]);
        expect(results.filter(result => result.status === 200)).toHaveLength(1);
        expect(results.filter(result => [401, 403].includes(result.status))).toHaveLength(1);
        expect(store.getUsername()).toBe(results[0].status === 200 ? 'winner' : 'loser');
    });
});

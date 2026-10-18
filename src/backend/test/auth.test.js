import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { authClient, authFixture } from './fixtures/auth.mjs';

const fixtures = [];
const secret = () => randomBytes(24).toString('base64url');
async function fixture(options) {
    const f = await authFixture(options);
    fixtures.push(f);
    return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

async function setup(client, username = 'administrator', password = secret()) {
    const result = await client.request('/auth/setup', { method: 'POST', body: { username, password } });
    expect(result.status).toBe(200);
    return { username, password, recoveryKey: result.data.recoveryKey };
}

describe('browser authentication HTTP contracts', () => {
    it('requires a management session even when a valid CSRF context is supplied', async () => {
        const { url } = await fixture();
        const client = authClient(url);
        expect((await client.request('/auth/status')).data).toMatchObject({ authEnabled: true, setupRequired: true });
        expect((await client.request('/protected')).status).toBe(401);
        expect((await client.request('/protected', { method: 'PUT', csrf: false })).status).toBe(403);
        expect((await client.request('/protected', { method: 'PUT' })).status).toBe(401);
        await setup(client);
        expect((await client.request('/protected', { method: 'PUT' })).status).toBe(200);
        const anonymous = authClient(url);
        expect((await anonymous.request('/protected', { method: 'PUT' })).status).toBe(401);
    });
    it('locks management before setup, protects setup from CSRF and never returns a login token', async () => {
        const { url } = await fixture();
        const client = authClient(url);
        expect((await client.request('/protected')).status).toBe(401);
        expect((await client.request('/auth/status')).data).toMatchObject({ setupRequired: true, enrollmentRequired: false, authenticated: false });
        expect((await client.request('/auth/setup', { method: 'POST', csrf: false, body: { username: 'administrator', password: secret() } })).status).toBe(403);
        const credentials = await setup(client);
        expect(credentials.recoveryKey).toBeTruthy();
        expect((await client.request('/protected')).status).toBe(200);
        expect((await client.request('/auth/status')).data).toMatchObject({ setupRequired: false, authenticated: true });
        expect((await client.request('/auth/setup', { method: 'POST', body: credentials })).status).toBe(409);
        expect((await client.request('/auth/sessions', { method: 'POST', body: credentials })).data).not.toHaveProperty('token');
    });

    it('requires legacy login before enrollment and retires it only after successful persistence', async () => {
        const env = { CADDY_UI_USER: 'legacy', CADDY_UI_PASSWORD: secret(), JWT_SECRET: secret() };
        const f = await fixture({ env });
        const client = authClient(f.url);
        expect((await client.request('/auth/status')).data.enrollmentRequired).toBe(true);
        expect((await client.request('/auth/setup', { method: 'POST', body: { username: 'new', password: secret() } })).status).toBe(401);
        expect((await client.request('/auth/sessions', { method: 'POST', body: { username: env.CADDY_UI_USER, password: env.CADDY_UI_PASSWORD } })).status).toBe(200);
        expect((await client.request('/protected')).status).toBe(401);
        await mkdir(f.path);
        expect((await client.request('/auth/setup', { method: 'POST', body: { username: 'new', password: secret() } })).status).toBe(503);
        expect((await client.request('/auth/status')).data).toMatchObject({ enrollmentRequired: true, enrollmentAuthenticated: true });
        await rm(f.path, { recursive: true });
        const next = await setup(client, 'new');
        expect((await client.request('/protected')).status).toBe(200);
        const other = authClient(f.url);
        expect((await other.request('/auth/sessions', { method: 'POST', body: { username: env.CADDY_UI_USER, password: env.CADDY_UI_PASSWORD } })).status).toBe(401);
        expect((await other.request('/auth/sessions', { method: 'POST', body: next })).status).toBe(200);
    });

    it('invalidates old sessions, streams and recovery keys on recovery', async () => {
        const { url } = await fixture();
        const first = authClient(url);
        const credentials = await setup(first);
        const stream = await fetch(url + '/api/stream', { headers: { cookie: first.cookie } });
        const reader = stream.body.getReader();
        await reader.read();
        const recovery = authClient(url);
        const result = await recovery.request('/auth/recovery', { method: 'POST', body: { recoveryKey: credentials.recoveryKey, password: secret() } });
        expect(result.status).toBe(200);
        expect(result.data.recoveryKey).not.toBe(credentials.recoveryKey);
        expect((await reader.read()).done).toBe(true);
        expect((await first.request('/protected')).status).toBe(401);
        expect((await recovery.request('/protected')).status).toBe(401);
        expect((await recovery.request('/auth/recovery', { method: 'POST', body: { recoveryKey: credentials.recoveryKey, password: secret() } })).status).toBe(401);
        expect((await recovery.request('/auth/sessions', { method: 'POST', body: credentials })).status).toBe(401);
    });

    it('preserves credentials, recovery key and active sessions when recovery cannot be persisted', async () => {
        const f = await fixture();
        const client = authClient(f.url);
        const credentials = await setup(client);
        await rename(f.path, f.path + '.original');
        await mkdir(f.path);
        const recovery = authClient(f.url);
        const body = { recoveryKey: credentials.recoveryKey, password: secret() };
        expect((await recovery.request('/auth/recovery', { method: 'POST', body })).status).toBe(503);
        expect((await client.request('/protected')).status).toBe(200);
        expect(await f.store.verifyPassword(credentials.username, credentials.password)).toBe(true);
        await rm(f.path, { recursive: true });
        await rename(f.path + '.original', f.path);
        expect((await recovery.request('/auth/recovery', { method: 'POST', body })).status).toBe(200);
        expect((await client.request('/protected')).status).toBe(401);
    });

    it('requires CSRF for login and logout and revokes the server-side session on logout', async () => {
        const { url } = await fixture();
        const client = authClient(url);
        const credentials = await setup(client);
        const oldCookie = client.cookie;
        expect((await client.request('/auth/sessions/current', { method: 'DELETE', csrf: false })).status).toBe(403);
        expect((await client.request('/auth/sessions/current', { method: 'DELETE' })).status).toBe(200);
        expect((await fetch(url + '/api/protected', { headers: { cookie: oldCookie } })).status).toBe(401);
        expect((await client.request('/auth/sessions', { method: 'POST', body: credentials, csrf: false })).status).toBe(403);
        const result = await client.request('/auth/sessions', { method: 'POST', body: credentials });
        expect(result.status).toBe(200);
        expect(result.headers.get('cache-control')).toBe('no-store');
        expect((await client.request('/protected')).status).toBe(200);
    });

    it('rejects legacy Bearer and URL credentials and blocks cross-origin writes even with valid CSRF', async () => {
        const { url } = await fixture();
        const client = authClient(url);
        await setup(client);
        const unauthorized = authClient(url);
        expect((await unauthorized.request('/protected', { headers: { Authorization: 'Bearer ' + secret() } })).status).toBe(401);
        expect((await unauthorized.request('/protected?token=' + secret())).status).toBe(401);
        expect((await client.request('/auth/sessions/current', { method: 'DELETE', headers: { Origin: 'https://attacker.example' } })).status).toBe(403);
        expect((await client.request('/protected')).status).toBe(200);
    });
});

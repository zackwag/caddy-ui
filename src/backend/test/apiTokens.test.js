import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as instances from '../src/instances.js';
import { createAuthStore } from '../src/authStore.js';
import { authClient, authFixture } from './fixtures/auth.mjs';

const fixtures = [];
const secret = () => randomBytes(24).toString('base64url');
const instance = id => ({ id, name: id, adminUrl: 'http://caddy:2019', configPath: '/etc/caddy/Caddyfile',
    logPath: '/var/log/caddy/access.log', dataPath: '/data/caddy', containerName: 'caddy', serverName: 'srv0' });
const input = (updates = {}) => ({ name: 'Homepage', scopes: ['status:read'], instanceIds: ['default'], expiresInDays: 30, ...updates });
beforeEach(() => {
    vi.spyOn(instances, 'getInstances').mockReturnValue([instance('default'), instance('second')]);
    vi.spyOn(instances, 'getInstance').mockImplementation(id => !id || id === 'default'
        ? instances.getInstances().find(instance => instance.id === 'default') || instances.getInstances()[0]
        : instances.getInstances().find(instance => instance.id === id) || null);
});
afterEach(async () => {
    for (const fixture of fixtures.splice(0)) await fixture.close();
    vi.restoreAllMocks();
});

async function fixture() {
    const f = await authFixture();
    fixtures.push(f);
    const client = authClient(f.url);
    const credentials = { username: 'administrator', password: secret() };
    const setup = await client.request('/auth/setup', { method: 'POST', body: credentials });
    expect(setup.status).toBe(200);
    const issue = async (body = input()) => {
        const issued = await client.request('/auth/tokens', { method: 'POST', body });
        expect(issued.status).toBe(201);
        return issued.data;
    };
    return { ...f, client, credentials, recoveryKey: setup.data.recoveryKey, issue };
}

async function bearer(url, token, path, options = {}) {
    return fetch(url + '/api' + path, { ...options, headers: { Authorization: 'Bearer ' + token, ...options.headers } });
}

describe('scoped read-only integration tokens', () => {
    it('keeps session instance selection strict and authenticates before instance lookup', async () => {
        const f = await fixture();
        const headers = { 'X-Instance-Id': 'missing' };
        expect((await fetch(f.url + '/api/status', { headers })).status).toBe(401);
        const response = await f.client.request('/status', { headers });
        expect(response.status).toBe(404);
        expect(response.data.code).toBe('INSTANCE_SELECTION_INVALID');
    });
    it('preserves cookie login behind other proxy authentication schemes without accepting them as API credentials', async () => {
        const f = await fixture();
        const headers = { Authorization: 'Basic ' + Buffer.from(secret()).toString('base64') };
        expect((await f.client.request('/auth/status', { headers })).data.authenticated).toBe(true);
        expect((await f.client.request('/protected', { method: 'PUT', headers, csrf: false })).status).toBe(403);
        expect((await f.client.request('/protected', { method: 'PUT', headers })).status).toBe(200);
        expect((await fetch(f.url + '/api/status', { headers })).status).toBe(401);
    });
    it('serializes concurrent issuance and rejects damaged token policy in storage', async () => {
        const f = await fixture();
        const issued = await Promise.all([f.issue(), f.issue(input({ name: 'Another integration' }))]);
        expect(new Set(issued.map(token => token.id)).size).toBe(2);
        expect(f.store.listApiTokens()).toHaveLength(2);
        const record = JSON.parse(await readFile(f.path, 'utf8'));
        record.apiTokens[0].scopes = ['*'];
        await writeFile(f.path, JSON.stringify(record));
        await expect(createAuthStore(f.path).loadAuth()).rejects.toThrow('Refusing to start');
    });
    it('persists hashes only, survives restart, expires and revokes immediately', async () => {
        const f = await fixture();
        const issued = await f.issue();
        expect(issued.token).toMatch(/^cui_[A-Za-z0-9_-]{43}$/);
        expect(issued).not.toHaveProperty('hash');
        expect(issued.name).toBe('Homepage');
        const raw = await readFile(f.path, 'utf8');
        expect(raw).not.toContain(issued.token);
        const restarted = createAuthStore(f.path);
        await restarted.loadAuth();
        expect(restarted.verifyApiToken(issued.token)?.id).toBe(issued.id);
        expect(restarted.listApiTokens()[0]).not.toHaveProperty('hash');
        expect(JSON.stringify((await f.client.request('/auth/tokens')).data)).not.toContain(issued.token);
        const expired = createAuthStore(f.path, { now: () => Date.parse(issued.expiresAt) });
        await expired.loadAuth();
        expect(expired.verifyApiToken(issued.token)).toBeNull();
        expect((await f.client.request('/auth/tokens/' + issued.id, { method: 'DELETE' })).status).toBe(200);
        expect((await bearer(f.url, issued.token, '/status')).status).toBe(401);
        await restarted.loadAuth();
        expect(restarted.verifyApiToken(issued.token)).toBeNull();
    });

    it('permits only exact scoped reads and selected instances without fallback', async () => {
        const f = await fixture();
        const status = await f.issue();
        expect((await bearer(f.url, status.token, '/status')).status).toBe(200);
        expect((await bearer(f.url, status.token, '/status', { method: 'HEAD' })).status).toBe(200);
        for (const path of ['/metrics', '/metrics/raw', '/metrics/config', '/status/process', '/caddyfile', '/caddyfile/history', '/routes', '/tls', '/route-notes', '/logs/app', '/instances', '/auth/tokens', '/auth/csrf', '/auth/status']) {
            expect((await bearer(f.url, status.token, path)).status, path).toBe(403);
        }
        expect((await bearer(f.url, status.token, '/status', { headers: { 'X-Instance-Id': 'second' } })).status).toBe(403);
        const unpermitted = await bearer(f.url, status.token, '/status', { headers: { 'X-Instance-Id': 'missing' } });
        expect(unpermitted.status).toBe(403);
        expect((await unpermitted.json()).code).toBe('FORBIDDEN');
        const metrics = await f.issue(input({ scopes: ['metrics:read'], instanceIds: ['second'] }));
        expect((await bearer(f.url, metrics.token, '/metrics/raw', { headers: { 'X-Instance-Id': 'default' } })).status).toBe(403);
        expect((await bearer(f.url, metrics.token, '/metrics/raw', { headers: { 'X-Instance-Id': 'second' } })).status).toBe(200);
        vi.mocked(instances.getInstances).mockReturnValue([instance('default')]);
        for (const headers of [{ 'X-Instance-Id': 'second' }, {}]) {
            const removed = await bearer(f.url, metrics.token, '/metrics/raw', { headers });
            expect(removed.status).toBe(404);
            expect((await removed.json()).code).toBe('INSTANCE_SELECTION_INVALID');
        }
    });

    it('defaults a header-less request to the token\'s only instance, and broader tokens to default', async () => {
        vi.mocked(instances.getInstances).mockReturnValue([instance('default'), instance('second'), instance('third')]);
        const f = await fixture();
        const servedInstance = async instanceIds => {
            const response = await bearer(f.url, (await f.issue(input({ instanceIds }))).token, '/status');
            return response.status === 200 ? (await response.json()).instanceId : response.status;
        };
        expect(await servedInstance(['second'])).toBe('second');
        expect(await servedInstance(['second', 'default'])).toBe('default');
        expect(await servedInstance(['second', 'third'])).toBe(403);
    });

    it('never authorizes writes, mints sessions or falls back to a more privileged cookie', async () => {
        const f = await fixture();
        const issued = await f.issue();
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
            expect((await bearer(f.url, issued.token, '/status', { method })).status).toBe(403);
        }
        for (const path of ['/auth/sessions', '/auth/setup', '/auth/recovery', '/auth/tokens']) {
            expect((await bearer(f.url, issued.token, path, { method: 'POST' })).status).toBe(403);
        }
        const csrf = await f.client.request('/auth/csrf');
        expect((await bearer(f.url, issued.token, '/protected', { method: 'PUT', headers: {
            Cookie: f.client.cookie, 'X-CSRF-Token': csrf.data.csrfToken,
        } })).status).toBe(403);
        expect((await bearer(f.url, secret(), '/protected', { headers: { Cookie: f.client.cookie } })).status).toBe(401);
        const response = await bearer(f.url, issued.token, '/status');
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect((await fetch(f.url + '/api/status?token=' + issued.token)).status).toBe(401);
    });

    it('requires session authentication and CSRF for token management', async () => {
        const f = await fixture();
        const anonymous = authClient(f.url);
        expect((await anonymous.request('/auth/tokens')).status).toBe(401);
        expect((await anonymous.request('/auth/tokens', { method: 'POST', body: input() })).status).toBe(401);
        expect((await f.client.request('/auth/tokens', { method: 'POST', body: input(), csrf: false })).status).toBe(403);
        expect((await f.client.request('/auth/tokens', { method: 'POST', body: input(), headers: { Origin: 'https://attacker.example' } })).status).toBe(403);
        const issued = await f.issue();
        expect((await f.client.request('/auth/tokens/' + issued.id, { method: 'DELETE', csrf: false })).status).toBe(403);
        expect((await bearer(f.url, issued.token, '/status')).status).toBe(200);
    });

    it.each([
        { scopes: [] }, { scopes: ['status:write'] }, { scopes: ['status:read', 'status:read'] },
        { instanceIds: [] }, { instanceIds: ['missing'] }, { instanceIds: ['*'] },
        { expiresInDays: 0 }, { expiresInDays: 366 }, { name: ' ' },
    ])('rejects invalid or broadened permissions %j', async updates => {
        const f = await fixture();
        expect((await f.client.request('/auth/tokens', { method: 'POST', body: input(updates) })).status).toBe(400);
    });

    it('preserves existing tokens when a write fails and revokes all tokens on password recovery', async () => {
        const f = await fixture();
        const issued = await f.issue();
        await rename(f.path, f.path + '.original');
        await mkdir(f.path);
        expect((await f.client.request('/auth/tokens', { method: 'POST', body: input() })).status).toBe(503);
        expect(f.store.listApiTokens()).toHaveLength(1);
        expect((await f.client.request('/auth/tokens/' + issued.id, { method: 'DELETE' })).status).toBe(503);
        expect((await bearer(f.url, issued.token, '/status')).status).toBe(200);
        await rm(f.path, { recursive: true });
        await rename(f.path + '.original', f.path);
        const recovery = authClient(f.url);
        expect((await recovery.request('/auth/recovery', { method: 'POST', body: { recoveryKey: f.recoveryKey, password: secret() } })).status).toBe(200);
        expect((await bearer(f.url, issued.token, '/status')).status).toBe(401);
        const restarted = createAuthStore(f.path);
        await restarted.loadAuth();
        expect(restarted.verifyApiToken(issued.token)).toBeNull();
    });
});

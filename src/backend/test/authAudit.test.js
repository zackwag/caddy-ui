import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authClient, authFixture } from './fixtures/auth.mjs';
import { authenticator } from './fixtures/webauthn.mjs';
import logger from '../src/logger.js';

const { notifyAuthenticationEvent } = vi.hoisted(() => ({ notifyAuthenticationEvent: vi.fn() }));
vi.mock('../src/notifications.js', () => ({ notifyAuthenticationEvent }));
const secret = () => randomBytes(24).toString('base64url');
const fixtures = [];
async function fixture() {
    const f = await authFixture({ env: { CADDY_UI_EXTERNAL_URL: 'https://ui.example.com' } });
    fixtures.push(f);
    const client = authClient(f.url);
    const password = secret();
    const setup = await client.request('/auth/setup', { method: 'POST', body: { username: 'administrator', password } });
    return { ...f, client, password, recoveryKey: setup.data.recoveryKey };
}
const events = () => notifyAuthenticationEvent.mock.calls.map(([event]) => event);
beforeEach(() => notifyAuthenticationEvent.mockReset());
afterEach(async () => {
    vi.restoreAllMocks();
    for (const f of fixtures.splice(0).reverse()) await f.close();
});

describe('authentication audit integration', () => {
    it('records credential outcomes without treating setup or password confirmation as sign-ins', async () => {
        const f = await fixture();
        expect(events()).toEqual([]);
        await f.client.request('/auth/credentials', { method: 'PATCH', body: { currentPassword: secret(), username: 'other' } });
        expect(events()).toEqual([]);
        const client = authClient(f.url);
        expect((await client.request('/auth/sessions', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.10' },
            body: { username: 'administrator', password: secret() } })).status).toBe(401);
        expect((await client.request('/auth/sessions', { method: 'POST', body: { username: 'administrator', password: f.password } })).status).toBe(200);
        expect((await client.request('/auth/recovery', { method: 'POST', body: { recoveryKey: secret(), password: secret() } })).status).toBe(401);
        expect((await client.request('/auth/recovery', { method: 'POST', body: { recoveryKey: f.recoveryKey, password: secret() } })).status).toBe(200);
        expect(events().map(({ method, outcome, priority }) => [method, outcome, priority])).toEqual([
            ['password', 'failure', 'default'], ['password', 'success', 'default'],
            ['recovery', 'failure', 'high'], ['recovery', 'success', 'high'],
        ]);
        expect(events().every(event => event.sourceIp === '127.0.0.1')).toBe(true);
        for (const value of [f.password, f.recoveryKey, '203.0.113.10']) expect(JSON.stringify(events())).not.toContain(value);
    });

    it('warns for password fallback and records real signed passkey success and rejection', async () => {
        const f = await fixture();
        const device = authenticator();
        const options = await f.client.request('/auth/passkeys/registration/options', { method: 'POST', body: { name: 'Laptop', currentPassword: f.password } });
        expect((await f.client.request('/auth/passkeys/registration', { method: 'POST', body: device.registration(options.data) })).status).toBe(201);
        expect(events()).toEqual([]);
        const client = authClient(f.url);
        expect((await client.request('/auth/sessions', { method: 'POST', body: { username: 'administrator', password: f.password } })).status).toBe(200);
        expect(events()[0]).toMatchObject({ method: 'password', outcome: 'success', passkeysConfigured: true, priority: 'high' });
        const visitor = authClient(f.url);
        let challenge = await visitor.request('/auth/passkeys/authentication/options', { method: 'POST' });
        expect(events()).toHaveLength(1);
        expect((await visitor.request('/auth/passkeys/authentication', { method: 'POST', body: device.assertion(challenge.data, { verified: false }) })).status).toBe(400);
        challenge = await visitor.request('/auth/passkeys/authentication/options', { method: 'POST' });
        expect((await visitor.request('/auth/passkeys/authentication', { method: 'POST', body: device.assertion(challenge.data) })).status).toBe(200);
        expect(events().slice(1).map(({ method, outcome, priority }) => [method, outcome, priority])).toEqual([
            ['passkey', 'failure', 'default'], ['passkey', 'success', 'default'],
        ]);
    });

    it('does not report persistence failures as rejected recovery credentials or successful recovery', async () => {
        const f = await fixture();
        vi.spyOn(f.store, 'replaceCredentials').mockRejectedValue(new Error('storage unavailable'));
        const result = await f.client.request('/auth/recovery', { method: 'POST', body: { recoveryKey: f.recoveryKey, password: secret() } });
        expect(result.data.code).toBe('AUTH_PERSISTENCE_FAILED');
        expect(events()).toEqual([]);
    });

    it('finishes sign-in while delivery is slow or fails', async () => {
        const f = await fixture();
        notifyAuthenticationEvent.mockReturnValueOnce(new Promise(() => {}))
            .mockRejectedValueOnce(new Error('provider unavailable'));
        const warning = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const client = authClient(f.url);
        for (let i = 0; i < 2; i++) {
            expect((await client.request('/auth/sessions', { method: 'POST', body: { username: 'administrator', password: f.password } })).status).toBe(200);
            expect((await client.request('/protected')).status).toBe(200);
        }
        await vi.waitFor(() => expect(warning).toHaveBeenCalledWith('Authentication notification delivery failed', { method: 'password', outcome: 'success' }));
    });
});

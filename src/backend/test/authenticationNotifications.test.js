import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationsFixture } from './fixtures/notifications.mjs';

const { sendWebhook } = vi.hoisted(() => ({ sendWebhook: vi.fn() }));
vi.mock('../src/webhookTransport.js', () => ({ sendWebhook }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../src/logger.js', () => ({ default: logger }));

const config = (overrides = {}) => ({ enabled: true, provider: 'ntfy', ntfy: { url: 'https://ntfy.example.com/security' },
    debounceMinutes: 1, triggers: { authentication: true, certExpiring: false, updateAvailable: false, apiTokenExpiring: false }, ...overrides });

let notifications;

// Authentication events reach notifications through the authEvents listener.
function record({ method = 'password', outcome = 'failure', sourceIp = '192.0.2.10', passkeysConfigured = false } = {}) {
    notifications.recordAuthentication({ ip: sourceIp }, method, outcome, passkeysConfigured);
}

async function sign(event) {
    record(event);
    await vi.advanceTimersByTimeAsync(0);
}

beforeEach(async () => {
    vi.useFakeTimers();
    sendWebhook.mockReset().mockResolvedValue(undefined);
    for (const log of Object.values(logger)) {
        log.mockClear();
    }
    notifications = await notificationsFixture({ config: config() });
});
afterEach(async () => {
    await notifications.close();
    vi.useRealTimers();
});

describe('authentication notifications', () => {
    it.each([
        ['password', 'success', false, 'Password sign-in succeeded', 'default'],
        ['password', 'success', true, 'Password sign-in while passkeys are configured', 'high'],
        ['password', 'failure', false, 'Password sign-in failed', 'default'],
        ['password-totp', 'success', false, 'Password and authenticator sign-in succeeded', 'default'],
        ['password-totp', 'success', true, 'Password sign-in while passkeys are configured', 'high'],
        ['totp', 'failure', false, 'Authenticator sign-in failed', 'default'],
        ['passkey', 'success', false, 'Passkey sign-in succeeded', 'default'],
        ['passkey', 'failure', false, 'Passkey sign-in failed', 'default'],
        ['recovery', 'success', false, 'Account recovery succeeded', 'high'],
        ['recovery', 'failure', false, 'Account recovery failed', 'high'],
    ])('%s %s has a fixed title and priority (passkeys: %s)', async (method, outcome, passkeysConfigured, title, priority) => {
        await sign({ method, outcome, passkeysConfigured });
        expect(sendWebhook).toHaveBeenCalledOnce();
        expect(sendWebhook.mock.calls[0][1].headers).toMatchObject({ Title: title, Priority: priority });
    });

    it('requires both the master switch and the authentication trigger', async () => {
        await notifications.configure(config({ enabled: false }));
        await sign();
        await notifications.configure(config({ triggers: { authentication: false, updateAvailable: false, apiTokenExpiring: false, certExpiring: false } }));
        await sign();
        expect(sendWebhook).not.toHaveBeenCalled();
    });

    it('uses the existing configured provider with safe event metadata', async () => {
        await notifications.configure(config({ provider: 'custom', custom: { url: 'https://hooks.example.com/security', method: 'POST' } }));
        await sign({ method: 'recovery' });
        expect(sendWebhook).toHaveBeenCalledOnce();
        const [url, request] = sendWebhook.mock.calls[0];
        expect(url).toBe('https://hooks.example.com/security');
        expect(JSON.parse(request.body)).toMatchObject({ priority: 'high', message: expect.stringContaining('Source IP: 192.0.2.10') });
    });

    it('sends the first failure immediately, then summarizes additional attempts across IPs', async () => {
        await sign();
        await sign({ sourceIp: '192.0.2.11' });
        await sign({ sourceIp: '192.0.2.12' });
        expect(sendWebhook).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sendWebhook).toHaveBeenCalledTimes(2);
        expect(sendWebhook.mock.calls[1][1].body).toContain('2 additional failed password attempts');
        expect(sendWebhook.mock.calls[1][1].body).toContain('Latest source IP: 192.0.2.12');
        expect(sendWebhook.mock.calls[1][1].headers.Priority).toBe('default');
        await sign();
        expect(sendWebhook).toHaveBeenCalledTimes(3);
    });

    it('does not send an empty summary for an isolated failed attempt', async () => {
        await sign();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sendWebhook).toHaveBeenCalledTimes(1);
    });

    it('keeps failure methods separate and never suppresses successful sign-in or recovery', async () => {
        await sign();
        await sign();
        await sign({ method: 'passkey' });
        await sign({ method: 'recovery' });
        await sign({ outcome: 'success', passkeysConfigured: true });
        await sign({ method: 'recovery', outcome: 'success' });
        expect(sendWebhook).toHaveBeenCalledTimes(5);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sendWebhook).toHaveBeenCalledTimes(6);
    });

    it.each(['disable', 'destination'])('discards pending summaries on a configuration change: %s', async change => {
        await sign();
        await sign();
        await notifications.configure(config(change === 'disable' ? { enabled: false } : { ntfy: { url: 'https://ntfy.example.com/other' } }));
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sendWebhook).toHaveBeenCalledTimes(1);
    });

    it('contains a failed summary delivery without logging provider response contents', async () => {
        await sign();
        await sign();
        logger.warn.mockClear();
        sendWebhook.mockRejectedValueOnce(new Error('private provider response'));
        await vi.advanceTimersByTimeAsync(60_000);
        expect(logger.warn).toHaveBeenCalledWith('Authentication notification summary delivery failed', { method: 'password' });
        expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private');
    });

    it('contains a failed immediate delivery without logging provider response contents', async () => {
        sendWebhook.mockRejectedValueOnce(new Error('private provider response'));
        await sign({ outcome: 'success' });
        expect(logger.warn).toHaveBeenCalledWith('Authentication notification delivery failed', { method: 'password', outcome: 'success' });
        expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private');
    });

    it('bounds slow deliveries and allows later notifications after capacity is released', async () => {
        let release;
        sendWebhook.mockReturnValue(new Promise(resolve => { release = resolve; }));
        for (let i = 0; i < 12; i++) {
            record({ outcome: 'success' });
        }
        await vi.advanceTimersByTimeAsync(0);
        expect(sendWebhook).toHaveBeenCalledTimes(8);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith('Authentication notification skipped: delivery capacity reached');
        release();
        await vi.advanceTimersByTimeAsync(0);
        sendWebhook.mockResolvedValue(undefined);
        await sign({ outcome: 'success' });
        expect(sendWebhook).toHaveBeenCalledTimes(9);
    });
});

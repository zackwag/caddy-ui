import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import logger from '../src/logger.js';
import { notifyAuthenticationEvent, updateMonitorConfig } from '../src/notifications.js';

const { sendWebhook } = vi.hoisted(() => ({ sendWebhook: vi.fn() }));
vi.mock('../src/webhookTransport.js', () => ({ sendWebhook }));
const config = (overrides = {}) => ({ enabled: true, provider: 'ntfy', ntfy: { url: 'https://ntfy.example.com/security' },
    debounceMinutes: 1, triggers: { authentication: true, updateAvailable: false, apiTokenExpiring: false }, ...overrides });
const event = (overrides = {}) => ({ event: 'authentication', timestamp: new Date().toISOString(), method: 'password',
    outcome: 'failure', sourceIp: '192.0.2.10', title: 'Password sign-in failed', priority: 'default', ...overrides });

beforeEach(() => {
    vi.useFakeTimers();
    sendWebhook.mockReset().mockResolvedValue(undefined);
    updateMonitorConfig(config());
});
afterEach(() => {
    updateMonitorConfig(config({ enabled: false }));
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('authentication notifications', () => {
    it('requires both the master switch and the authentication trigger', async () => {
        updateMonitorConfig(config({ enabled: false }));
        await notifyAuthenticationEvent(event());
        updateMonitorConfig(config({ triggers: { updateAvailable: false, apiTokenExpiring: false } }));
        await notifyAuthenticationEvent(event());
        expect(sendWebhook).not.toHaveBeenCalled();
    });

    it('uses the existing configured provider with safe event metadata', async () => {
        updateMonitorConfig(config({ provider: 'custom', custom: { url: 'https://hooks.example.com/security', method: 'POST' } }));
        await notifyAuthenticationEvent(event({ method: 'recovery', priority: 'high' }));
        expect(sendWebhook).toHaveBeenCalledOnce();
        const [url, request] = sendWebhook.mock.calls[0];
        expect(url).toBe('https://hooks.example.com/security');
        expect(JSON.parse(request.body)).toMatchObject({ priority: 'high', message: expect.stringContaining('Source IP: 192.0.2.10') });
    });

    it('sends the first failure immediately, then summarizes additional attempts across IPs', async () => {
        await notifyAuthenticationEvent(event());
        await notifyAuthenticationEvent(event({ sourceIp: '192.0.2.11' }));
        await notifyAuthenticationEvent(event({ sourceIp: '192.0.2.12' }));
        expect(sendWebhook).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sendWebhook).toHaveBeenCalledTimes(2);
        expect(sendWebhook.mock.calls[1][1].body).toContain('2 additional failed password attempts');
        expect(sendWebhook.mock.calls[1][1].body).toContain('Latest source IP: 192.0.2.12');
        expect(sendWebhook.mock.calls[1][1].headers.Priority).toBe('default');
        await notifyAuthenticationEvent(event());
        expect(sendWebhook).toHaveBeenCalledTimes(3);
    });

    it('does not send an empty summary for an isolated failed attempt', async () => {
        await notifyAuthenticationEvent(event());
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sendWebhook).toHaveBeenCalledTimes(1);
    });

    it('keeps failure methods separate and never suppresses successful sign-in or recovery', async () => {
        await notifyAuthenticationEvent(event());
        await notifyAuthenticationEvent(event());
        await notifyAuthenticationEvent(event({ method: 'passkey' }));
        await notifyAuthenticationEvent(event({ method: 'recovery', priority: 'high' }));
        await notifyAuthenticationEvent(event({ outcome: 'success', priority: 'high' }));
        await notifyAuthenticationEvent(event({ method: 'recovery', outcome: 'success', priority: 'high' }));
        expect(sendWebhook).toHaveBeenCalledTimes(5);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sendWebhook).toHaveBeenCalledTimes(6);
    });

    it.each(['disable', 'destination'])('discards pending summaries on a configuration change: %s', async change => {
        await notifyAuthenticationEvent(event());
        await notifyAuthenticationEvent(event());
        updateMonitorConfig(config(change === 'disable' ? { enabled: false } : { ntfy: { url: 'https://ntfy.example.com/other' } }));
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sendWebhook).toHaveBeenCalledTimes(1);
    });

    it('contains a failed summary delivery without logging provider response contents', async () => {
        await notifyAuthenticationEvent(event());
        await notifyAuthenticationEvent(event());
        const warning = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        sendWebhook.mockRejectedValueOnce(new Error('private provider response'));
        await vi.advanceTimersByTimeAsync(60_000);
        expect(warning).toHaveBeenCalledWith('Authentication notification summary delivery failed', { method: 'password' });
        expect(JSON.stringify(warning.mock.calls)).not.toContain('private');
    });

    it('bounds slow deliveries and allows later notifications after capacity is released', async () => {
        let release;
        sendWebhook.mockReturnValue(new Promise(resolve => { release = resolve; }));
        const warning = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const pending = Array.from({ length: 12 }, () => notifyAuthenticationEvent(event({ outcome: 'success' })));
        expect(sendWebhook).toHaveBeenCalledTimes(8);
        expect(warning).toHaveBeenCalledTimes(1);
        release();
        await Promise.all(pending);
        sendWebhook.mockResolvedValue(undefined);
        await notifyAuthenticationEvent(event({ outcome: 'success' }));
        expect(sendWebhook).toHaveBeenCalledTimes(9);
    });
});

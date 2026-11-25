import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationsFixture } from './fixtures/notifications.mjs';

const { sendWebhook } = vi.hoisted(() => ({ sendWebhook: vi.fn() }));
vi.mock('../src/webhookTransport.js', () => ({ sendWebhook }));
vi.mock('../src/instances.js', () => ({ getInstances: () => [] }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../src/logger.js', () => ({ default: logger }));

const triggers = { configurationChange: true, certExpiring: false, updateAvailable: false, apiTokenExpiring: false };
const config = (overrides = {}) => ({ enabled: true, provider: 'ntfy', ntfy: { url: 'https://ntfy.example.com/caddy' }, debounceMinutes: 1, triggers, ...overrides });
const change = (overrides = {}) => ({ instanceId: 'i1', instanceName: 'Main', representations: ['file', 'live'],
    detectedAt: '2026-11-21T10:00:00.000Z', historyEntry: 'Caddyfile-2026-11-21T10-00-00-000Z-x.json', ...overrides });

let notifications;

beforeEach(async () => {
    vi.useFakeTimers();
    sendWebhook.mockReset().mockResolvedValue(undefined);
    logger.warn.mockClear();
    notifications = await notificationsFixture({ config: config() });
});
afterEach(async () => {
    await notifications.close();
    vi.useRealTimers();
});

describe('configuration change notifications', () => {
    it('defaults to off', async () => {
        await notifications.configure({ ...config(), triggers: undefined });
        await notifications.notifyConfigurationChange(change());
        expect(sendWebhook).not.toHaveBeenCalled();
    });

    it('identifies the instance, representations, detection time, unknown source and history entry', async () => {
        await notifications.notifyConfigurationChange(change());
        expect(sendWebhook).toHaveBeenCalledOnce();
        const [, request] = sendWebhook.mock.calls[0];
        expect(request.headers).toMatchObject({ Title: 'Configuration changed outside caddy/ui', Priority: 'high' });
        expect(request.body).toBe([
            'Instance: Main',
            'Changed: Caddyfile and live configuration',
            'Detected: 2026-11-21T10:00:00.000Z',
            'Source: unknown, outside a tracked caddy/ui operation',
            'History entry: Caddyfile-2026-11-21T10-00-00-000Z-x.json',
        ].join('\n'));
    });

    it('omits the history reference when none was recorded', async () => {
        await notifications.notifyConfigurationChange(change({ historyEntry: null, representations: ['live'] }));
        expect(sendWebhook.mock.calls[0][1].body).not.toContain('History entry');
        expect(sendWebhook.mock.calls[0][1].body).toContain('Changed: live configuration');
    });

    it('summarizes later changes on the same instance once the cooldown ends', async () => {
        await notifications.notifyConfigurationChange(change());
        notifications.notifyConfigurationChange(change({ detectedAt: '2026-11-21T10:01:00.000Z' }));
        notifications.notifyConfigurationChange(change({ detectedAt: '2026-11-21T10:02:00.000Z' }));
        await notifications.notifyConfigurationChange(change({ instanceId: 'i2', instanceName: 'Other' }));
        expect(sendWebhook).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sendWebhook).toHaveBeenCalledTimes(3);
        expect(sendWebhook.mock.calls[2][1].body).toContain('2 additional unexplained configuration changes on Main');
        expect(sendWebhook.mock.calls[2][1].body).toContain('Detected: 2026-11-21T10:02:00.000Z');
        await notifications.notifyConfigurationChange(change({ detectedAt: '2026-11-21T10:05:00.000Z' }));
        expect(sendWebhook).toHaveBeenCalledTimes(4);
    });

    it('rejects on delivery failure without retaining a stuck batch', async () => {
        sendWebhook.mockRejectedValueOnce(new Error('provider down'));
        await expect(notifications.notifyConfigurationChange(change())).rejects.toThrow('provider down');
        await vi.advanceTimersByTimeAsync(60_000);
        await notifications.notifyConfigurationChange(change());
        expect(sendWebhook).toHaveBeenCalledTimes(2);
    });

    it('drops pending summaries when settings change or the instance is removed', async () => {
        await notifications.notifyConfigurationChange(change());
        notifications.notifyConfigurationChange(change());
        await notifications.configure(config());
        await notifications.notifyConfigurationChange(change({ instanceId: 'i2' }));
        notifications.notifyConfigurationChange(change({ instanceId: 'i2' }));
        notifications.forgetInstanceNotifications('i2');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sendWebhook).toHaveBeenCalledTimes(2);
    });
});

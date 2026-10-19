import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendWebhook } = vi.hoisted(() => ({ sendWebhook: vi.fn() }));
vi.mock('../src/webhookTransport.js', () => ({ sendWebhook }));

vi.mock('../src/instances.js', () => ({ getInstances: () => [{ id: 'i1', name: 'Main', adminUrl: 'http://localhost:2019', dataPath: '/data', containerName: '' }] }));

const { readContainerDir } = vi.hoisted(() => ({ readContainerDir: vi.fn() }));
vi.mock('../src/containerFs.js', async importOriginal => ({
    ...await importOriginal(),
    readContainerDir,
    readContainerFile: vi.fn().mockRejectedValue(new Error('not found')),
    listContainerDir: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/updateCheck.js', () => ({
    getUpdateNotification: () => ({ key: 'v9.9.9', title: 'Update available', message: 'v9.9.9 is out' }),
}));

vi.mock('../src/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function cfg() {
    return {
        enabled: true,
        provider: 'ntfy',
        ntfy: { url: 'http://ntfy/test' },
        debounceMinutes: 30,
        triggers: { upstreamOffline: false, upstreamOnline: false, certExpiring: true, updateAvailable: true, apiTokenExpiring: true },
    };
}

describe('notification category isolation', () => {
    let notifications;

    beforeEach(async () => {
        vi.useFakeTimers();
        sendWebhook.mockReset().mockResolvedValue(undefined);
        readContainerDir.mockReset();
        vi.resetModules();
        notifications = await import('../src/notifications.js');
    });

    afterEach(() => {
        notifications.updateMonitorConfig({ ...cfg(), enabled: false });
        vi.useRealTimers();
    });

    it('a throwing category does not prevent subsequent categories from running', async () => {
        // Fail an operation whose error reaches the category scheduler.
        readContainerDir.mockResolvedValue(['acme']);
        const { listContainerDir } = await import('../src/containerFs.js');
        listContainerDir.mockRejectedValue(new Error('simulated cert failure'));

        notifications.updateMonitorConfig(cfg());

        // Let the cycle's promises settle
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);

        // Update notification should still have been sent despite cert failure
        const updateCalls = sendWebhook.mock.calls.filter(
            ([, req]) => req.body?.includes?.('v9.9.9') || req.headers?.Title === 'Update available'
        );
        expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    });
});

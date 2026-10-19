import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendWebhook } = vi.hoisted(() => ({ sendWebhook: vi.fn() }));
vi.mock('../src/webhookTransport.js', () => ({ sendWebhook }));

const instances = [{ id: 'i1', name: 'Main', adminUrl: 'http://localhost:2019' }];
vi.mock('../src/instances.js', () => ({ getInstances: () => instances }));

vi.mock('../src/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const inst = instances[0];
const upstream = { upstream: '10.0.0.1:8080', domain: 'app.example.com' };

function cfg(overrides = {}) {
    return {
        enabled: true,
        provider: 'ntfy',
        ntfy: { url: 'http://ntfy/test' },
        debounceMinutes: 30,
        triggers: { upstreamOffline: true, upstreamOnline: true, certExpiring: false, updateAvailable: false, apiTokenExpiring: false },
        ...overrides,
    };
}

describe('upstream notification retries', () => {
    let notifications;

    beforeEach(async () => {
        vi.useFakeTimers();
        sendWebhook.mockReset().mockResolvedValue(undefined);
        vi.resetModules();
        notifications = await import('../src/notifications.js');
        notifications.updateMonitorConfig(cfg());
    });

    afterEach(() => {
        notifications.updateMonitorConfig({ ...cfg(), enabled: false });
        notifications.cancelAllPendingRetries();
        notifications._test.upstreamState.clear();
        notifications._test.deliveredOffline.clear();
        vi.useRealTimers();
    });

    function seed(online) {
        notifications._test.upstreamState.set('i1:10.0.0.1:8080', online);
    }

    it('retries delivery up to 3 times on failure', async () => {
        seed(true);
        sendWebhook.mockRejectedValue(new Error('ntfy responded 500'));

        await notifications.notifyUpstreamChecks(inst, [{ ...upstream, online: false }]);
        await vi.advanceTimersByTimeAsync(0);
        expect(sendWebhook).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(30_000);
        await vi.advanceTimersByTimeAsync(0);
        expect(sendWebhook).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(60_000);
        await vi.advanceTimersByTimeAsync(0);
        expect(sendWebhook).toHaveBeenCalledTimes(3);

        // No more retries after max attempts
        await vi.advanceTimersByTimeAsync(120_000);
        expect(sendWebhook).toHaveBeenCalledTimes(3);
        expect(notifications._test.pendingRetries.size).toBe(0);
    });

    it('stops retrying after successful delivery', async () => {
        seed(true);
        sendWebhook.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(undefined);

        await notifications.notifyUpstreamChecks(inst, [{ ...upstream, online: false }]);
        await vi.advanceTimersByTimeAsync(0);
        expect(sendWebhook).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(30_000);
        await vi.advanceTimersByTimeAsync(0);
        expect(sendWebhook).toHaveBeenCalledTimes(2);

        // No further retries after success
        await vi.advanceTimersByTimeAsync(120_000);
        expect(sendWebhook).toHaveBeenCalledTimes(2);
        expect(notifications._test.pendingRetries.size).toBe(0);
    });

    it('cancels pending retry when upstream state changes', async () => {
        seed(true);
        sendWebhook.mockRejectedValue(new Error('timeout'));

        await notifications.notifyUpstreamChecks(inst, [{ ...upstream, online: false }]);
        await vi.advanceTimersByTimeAsync(0);
        expect(notifications._test.pendingRetries.size).toBe(1);

        // Upstream comes back online before retry fires — cancels the pending offline retry
        sendWebhook.mockResolvedValue(undefined);
        await notifications.notifyUpstreamChecks(inst, [{ ...upstream, online: true }]);
        await vi.advanceTimersByTimeAsync(0);

        // Old offline retry timer should not fire
        await vi.advanceTimersByTimeAsync(120_000);
        // Only the initial failed attempt + whatever the state change triggered
        const offlineCalls = sendWebhook.mock.calls.filter(
            ([, req]) => req.headers?.Title === 'Upstream offline'
        );
        expect(offlineCalls).toHaveLength(1);
    });

    it('recovery alert requires a delivered offline alert', async () => {
        seed(true);

        // Go offline — delivery succeeds
        await notifications.notifyUpstreamChecks(inst, [{ ...upstream, online: false }]);
        await vi.advanceTimersByTimeAsync(0);
        expect(sendWebhook).toHaveBeenCalledTimes(1);
        expect(notifications._test.deliveredOffline.has('i1:10.0.0.1:8080')).toBe(true);

        // Go back online — recovery should fire
        sendWebhook.mockClear();
        await notifications.notifyUpstreamChecks(inst, [{ ...upstream, online: true }]);
        await vi.advanceTimersByTimeAsync(0);

        expect(sendWebhook).toHaveBeenCalledTimes(1);
        expect(sendWebhook.mock.calls[0][1].headers.Title).toBe('Upstream recovered');
    });

    it('suppresses recovery alert when offline was never delivered', async () => {
        seed(true);
        sendWebhook.mockRejectedValue(new Error('fail'));

        // Go offline — all delivery attempts fail
        await notifications.notifyUpstreamChecks(inst, [{ ...upstream, online: false }]);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(30_000);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(60_000);
        await vi.advanceTimersByTimeAsync(0);

        expect(notifications._test.deliveredOffline.has('i1:10.0.0.1:8080')).toBe(false);

        // Go back online
        sendWebhook.mockClear().mockResolvedValue(undefined);
        await notifications.notifyUpstreamChecks(inst, [{ ...upstream, online: true }]);
        await vi.advanceTimersByTimeAsync(0);

        const recoveryCalls = sendWebhook.mock.calls.filter(
            ([, req]) => req.headers?.Title === 'Upstream recovered'
        );
        expect(recoveryCalls).toHaveLength(0);
    });

    it('discards pending retries when trigger is disabled', async () => {
        seed(true);
        sendWebhook.mockRejectedValue(new Error('fail'));

        await notifications.notifyUpstreamChecks(inst, [{ ...upstream, online: false }]);
        await vi.advanceTimersByTimeAsync(0);
        expect(notifications._test.pendingRetries.size).toBe(1);

        notifications.updateMonitorConfig(cfg({
            triggers: { upstreamOffline: false, upstreamOnline: false, certExpiring: false, updateAvailable: false, apiTokenExpiring: false },
        }));

        expect(notifications._test.pendingRetries.size).toBe(0);
    });

    it('discards pending retries when monitor is stopped', async () => {
        seed(true);
        sendWebhook.mockRejectedValue(new Error('fail'));

        await notifications.notifyUpstreamChecks(inst, [{ ...upstream, online: false }]);
        await vi.advanceTimersByTimeAsync(0);
        expect(notifications._test.pendingRetries.size).toBe(1);

        notifications.updateMonitorConfig({ ...cfg(), enabled: false });
        expect(notifications._test.pendingRetries.size).toBe(0);
    });

    it('discards pending retry when upstream disappears', async () => {
        seed(true);
        sendWebhook.mockRejectedValue(new Error('fail'));

        await notifications.notifyUpstreamChecks(inst, [{ ...upstream, online: false }]);
        await vi.advanceTimersByTimeAsync(0);
        expect(notifications._test.pendingRetries.size).toBe(1);

        // Next round has no upstreams for this instance
        await notifications.notifyUpstreamChecks(inst, []);
        expect(notifications._test.pendingRetries.has('i1:10.0.0.1:8080')).toBe(false);
    });
});

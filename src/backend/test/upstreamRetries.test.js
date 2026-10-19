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

    function observe(online) {
        return notifications.notifyUpstreamChecks(inst, [{ ...upstream, online }]);
    }

    function titles() {
        return sendWebhook.mock.calls.map(([, request]) => request.headers.Title);
    }

    function deferred() {
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        return { promise, resolve, reject };
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

    it('does not revive a cancelled delivery after stop, recovery and restart', async () => {
        await observe(true);
        const delivery = deferred();
        sendWebhook.mockImplementationOnce(() => delivery.promise);
        const sending = observe(false);
        notifications.updateMonitorConfig(cfg({ enabled: false }));
        await observe(true);
        notifications.updateMonitorConfig(cfg());
        delivery.reject(new Error('late provider failure'));
        await sending;
        expect(notifications._test.pendingRetries.size).toBe(0);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(titles()).toEqual(['Upstream offline']);
    });

    it('does not record delivery history or cooldown for a cancelled successful send', async () => {
        await observe(true);
        const delivery = deferred();
        sendWebhook.mockImplementationOnce(() => delivery.promise);
        const sending = observe(false);
        notifications.updateMonitorConfig(cfg({ enabled: false }));
        delivery.resolve();
        await sending;
        notifications.updateMonitorConfig(cfg());
        await observe(true);
        await observe(false);
        expect(titles()).toEqual(['Upstream offline', 'Upstream offline']);
    });

    it.each([true, false])('keeps a replacement alert when cancelled delivery settles with success=%s', async success => {
        await observe(true);
        const old = deferred(), replacement = deferred();
        sendWebhook.mockImplementationOnce(() => old.promise);
        const sendingOld = observe(false);
        notifications.updateMonitorConfig(cfg({ enabled: false }));
        await observe(true);
        notifications.updateMonitorConfig(cfg());
        sendWebhook.mockImplementationOnce(() => replacement.promise);
        const sendingReplacement = observe(false);
        const key = `${inst.id}:${upstream.upstream}`;
        const pending = notifications._test.pendingRetries.get(key);
        expect(pending).toBeDefined();
        if (success) old.resolve();
        else old.reject(new Error('cancelled provider failure'));
        await sendingOld;
        const pendingAfterOldCompletion = notifications._test.pendingRetries.get(key);
        const deliveredAfterOldCompletion = notifications._test.deliveredOffline.has(key);
        replacement.resolve();
        await sendingReplacement;
        expect(pendingAfterOldCompletion).toBe(pending);
        expect(deliveredAfterOldCompletion).toBe(false);
        expect(notifications._test.pendingRetries.size).toBe(0);
        expect(notifications._test.deliveredOffline.has(key)).toBe(true);
    });

    it('does not revive an in-flight retry after recovery cancels it', async () => {
        await observe(true);
        const retry = deferred();
        sendWebhook.mockRejectedValueOnce(new Error('initial failure')).mockImplementationOnce(() => retry.promise);
        await observe(false);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(titles()).toHaveLength(2);
        await observe(true);
        retry.reject(new Error('late retry failure'));
        await vi.advanceTimersByTimeAsync(120_000);
        expect(titles()).toEqual(['Upstream offline', 'Upstream offline']);
        expect(notifications._test.pendingRetries.size).toBe(0);
    });

    it('retains recovery eligibility after a failed recovery and another flap', async () => {
        await observe(true);
        await observe(false);
        sendWebhook.mockRejectedValueOnce(new Error('recovery failed'));
        await observe(true);
        await observe(false);
        await observe(true);
        expect(titles()).toEqual(['Upstream offline', 'Upstream recovered', 'Upstream recovered']);
        expect(notifications._test.deliveredOffline.size).toBe(0);
    });

    it.each(['offline', 'online'])('discards only the disabled %s trigger before it is re-enabled', async type => {
        await observe(true);
        if (type === 'online') {
            await observe(false);
            sendWebhook.mockClear();
        }
        sendWebhook.mockRejectedValueOnce(new Error('provider failed'));
        await observe(type === 'online');
        const trigger = type === 'offline' ? 'upstreamOffline' : 'upstreamOnline';
        notifications.updateMonitorConfig(cfg({ triggers: { ...cfg().triggers, [trigger]: false } }));
        notifications.updateMonitorConfig(cfg());
        await vi.advanceTimersByTimeAsync(120_000);
        expect(titles()).toEqual([type === 'offline' ? 'Upstream offline' : 'Upstream recovered']);
    });

    it('preserves recovery retries when only the offline trigger is disabled', async () => {
        const observeBoth = (first, second) => notifications.notifyUpstreamChecks(inst, [
            { ...upstream, online: first }, { upstream: 'other:8080', online: second },
        ]);
        await observeBoth(true, true);
        await observeBoth(false, true);
        sendWebhook.mockRejectedValue(new Error('provider failed'));
        await observeBoth(true, false);
        notifications.updateMonitorConfig(cfg({ triggers: { ...cfg().triggers, upstreamOffline: false } }));
        sendWebhook.mockResolvedValue(undefined);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(titles()).toEqual(['Upstream offline', 'Upstream recovered', 'Upstream offline', 'Upstream recovered']);
    });

    it('forgets delivery history and cooldown when an upstream disappears', async () => {
        await observe(true);
        await observe(false);
        await notifications.notifyUpstreamChecks(inst, []);
        await observe(true);
        expect(titles()).toEqual(['Upstream offline']);
        await observe(false);
        expect(titles()).toEqual(['Upstream offline', 'Upstream offline']);
    });

    it('ignores an in-flight delivery that succeeds after upstream removal', async () => {
        await observe(true);
        const delivery = deferred();
        sendWebhook.mockImplementationOnce(() => delivery.promise);
        const sending = observe(false);
        await notifications.notifyUpstreamChecks(inst, []);
        delivery.resolve();
        await sending;
        await observe(true);
        expect(titles()).toEqual(['Upstream offline']);
        expect(notifications._test.deliveredOffline.size).toBe(0);
    });

    it.each([true, false])('releases instance history and pending work with delivered=%s', async delivered => {
        await observe(true);
        if (!delivered) sendWebhook.mockRejectedValueOnce(new Error('provider failed'));
        await observe(false);
        notifications.releaseInstanceNotifications(inst.id);
        expect(notifications._test.upstreamState.size).toBe(0);
        expect(notifications._test.deliveredOffline.size).toBe(0);
        expect(notifications._test.pendingRetries.size).toBe(0);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(titles()).toEqual(['Upstream offline']);
        await observe(false);
        await observe(true);
        await observe(false);
        expect(titles()).toEqual(['Upstream offline', 'Upstream offline']);
    });

    it('does not release a different instance with a similar id prefix', async () => {
        const other = { id: 'i10', name: 'Other' };
        await notifications.notifyUpstreamChecks(other, [{ ...upstream, online: true }]);
        await notifications.notifyUpstreamChecks(other, [{ ...upstream, online: false }]);
        notifications.releaseInstanceNotifications(inst.id);
        await notifications.notifyUpstreamChecks(other, [{ ...upstream, online: true }]);
        expect(titles()).toEqual(['Upstream offline', 'Upstream recovered']);
    });
});

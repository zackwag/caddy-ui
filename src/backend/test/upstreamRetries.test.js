import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationsFixture } from './fixtures/notifications.mjs';

const { sendWebhook } = vi.hoisted(() => ({ sendWebhook: vi.fn() }));
vi.mock('../src/webhookTransport.js', () => ({ sendWebhook }));

const instances = vi.hoisted(() => [
    { id: 'i1', name: 'Main', adminUrl: 'http://localhost:2019' },
    { id: 'i10', name: 'Other', adminUrl: 'http://localhost:2020' },
]);
vi.mock('../src/instances.js', () => ({ getInstances: () => instances }));

vi.mock('../src/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const inst = instances[0];
const result = (target, online) => ({ target, online, label: `app.example.com (${target})` });

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
        notifications = await notificationsFixture({ config: cfg() });
    });

    afterEach(async () => {
        await notifications.close();
        vi.useRealTimers();
    });

    function observe(online, owner = inst) {
        return notifications.notifyCheckResults('upstream', owner, [result('10.0.0.1:8080', online)]);
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
        await observe(true);
        sendWebhook.mockRejectedValue(new Error('ntfy responded 500'));

        await observe(false);
        expect(sendWebhook).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(sendWebhook).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(60_000);
        expect(sendWebhook).toHaveBeenCalledTimes(3);

        await vi.advanceTimersByTimeAsync(120_000);
        expect(sendWebhook).toHaveBeenCalledTimes(3);
    });

    it('stops retrying after successful delivery', async () => {
        await observe(true);
        sendWebhook.mockRejectedValueOnce(new Error('timeout'));

        await observe(false);
        expect(sendWebhook).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(sendWebhook).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(120_000);
        expect(sendWebhook).toHaveBeenCalledTimes(2);
    });

    it('cancels pending retry when upstream state changes', async () => {
        await observe(true);
        sendWebhook.mockRejectedValue(new Error('timeout'));
        await observe(false);

        sendWebhook.mockResolvedValue(undefined);
        await observe(true);
        await vi.advanceTimersByTimeAsync(120_000);

        expect(titles().filter(title => title === 'Upstream offline')).toHaveLength(1);
    });

    it('suppresses recovery alert when offline was never delivered', async () => {
        await observe(true);
        sendWebhook.mockRejectedValue(new Error('fail'));
        await observe(false);
        await vi.advanceTimersByTimeAsync(90_000);
        expect(sendWebhook).toHaveBeenCalledTimes(3);

        sendWebhook.mockClear().mockResolvedValue(undefined);
        await observe(true);
        expect(sendWebhook).not.toHaveBeenCalled();
    });

    it('discards pending retries when trigger is disabled', async () => {
        await observe(true);
        sendWebhook.mockRejectedValue(new Error('fail'));
        await observe(false);

        await notifications.configure(cfg({
            triggers: { upstreamOffline: false, upstreamOnline: false, certExpiring: false, updateAvailable: false, apiTokenExpiring: false },
        }));
        await vi.advanceTimersByTimeAsync(120_000);

        expect(sendWebhook).toHaveBeenCalledTimes(1);
    });

    it('discards pending retries when notifications are disabled', async () => {
        await observe(true);
        sendWebhook.mockRejectedValue(new Error('fail'));
        await observe(false);

        await notifications.configure(cfg({ enabled: false }));
        await vi.advanceTimersByTimeAsync(120_000);

        expect(sendWebhook).toHaveBeenCalledTimes(1);
    });

    it('discards pending retry when upstream disappears', async () => {
        await observe(true);
        sendWebhook.mockRejectedValue(new Error('fail'));
        await observe(false);

        await notifications.notifyCheckResults('upstream', inst, []);
        await vi.advanceTimersByTimeAsync(120_000);

        expect(sendWebhook).toHaveBeenCalledTimes(1);
    });

    it('does not revive a cancelled delivery after stop, recovery and restart', async () => {
        await observe(true);
        const delivery = deferred();
        sendWebhook.mockImplementationOnce(() => delivery.promise);
        const sending = observe(false);
        await notifications.configure(cfg({ enabled: false }));
        await observe(true);
        await notifications.configure(cfg());
        delivery.reject(new Error('late provider failure'));
        await sending;
        await vi.advanceTimersByTimeAsync(120_000);
        expect(titles()).toEqual(['Upstream offline']);
    });

    it('does not record delivery history or cooldown for a cancelled successful send', async () => {
        await observe(true);
        const delivery = deferred();
        sendWebhook.mockImplementationOnce(() => delivery.promise);
        const sending = observe(false);
        await notifications.configure(cfg({ enabled: false }));
        delivery.resolve();
        await sending;
        await notifications.configure(cfg());
        await observe(true);
        await observe(false);
        expect(titles()).toEqual(['Upstream offline', 'Upstream offline']);
    });

    it.each([true, false])('keeps a replacement alert when cancelled delivery settles with success=%s', async success => {
        await observe(true);
        const old = deferred(), replacement = deferred();
        sendWebhook.mockImplementationOnce(() => old.promise);
        const sendingOld = observe(false);
        await notifications.configure(cfg({ enabled: false }));
        await observe(true);
        await notifications.configure(cfg());
        sendWebhook.mockImplementationOnce(() => replacement.promise);
        const sendingReplacement = observe(false);
        if (success) {
            old.resolve();
        } else {
            old.reject(new Error('cancelled provider failure'));
        }
        await sendingOld;

        // The replacement still owns the retry, so its failure is retried
        replacement.reject(new Error('replacement failure'));
        await sendingReplacement;
        await vi.advanceTimersByTimeAsync(30_000);
        expect(titles()).toEqual(['Upstream offline', 'Upstream offline', 'Upstream offline']);

        // and its eventual delivery makes the recovery announceable
        await observe(true);
        expect(titles().at(-1)).toBe('Upstream recovered');
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
    });

    it('retains recovery eligibility after a failed recovery and another flap', async () => {
        await observe(true);
        await observe(false);
        sendWebhook.mockRejectedValueOnce(new Error('recovery failed'));
        await observe(true);
        await observe(false);
        await observe(true);
        expect(titles()).toEqual(['Upstream offline', 'Upstream recovered', 'Upstream recovered']);
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
        await notifications.configure(cfg({ triggers: { ...cfg().triggers, [trigger]: false } }));
        await notifications.configure(cfg());
        await vi.advanceTimersByTimeAsync(120_000);
        expect(titles()).toEqual([type === 'offline' ? 'Upstream offline' : 'Upstream recovered']);
    });

    it('preserves recovery retries when only the offline trigger is disabled', async () => {
        const observeBoth = (first, second) => notifications.notifyCheckResults('upstream', inst, [
            result('10.0.0.1:8080', first), result('other:8080', second),
        ]);
        await observeBoth(true, true);
        await observeBoth(false, true);
        sendWebhook.mockRejectedValue(new Error('provider failed'));
        await observeBoth(true, false);
        await notifications.configure(cfg({ triggers: { ...cfg().triggers, upstreamOffline: false } }));
        sendWebhook.mockResolvedValue(undefined);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(titles()).toEqual(['Upstream offline', 'Upstream recovered', 'Upstream offline', 'Upstream recovered']);
    });

    it('forgets delivery history and cooldown when an upstream disappears', async () => {
        await observe(true);
        await observe(false);
        await notifications.notifyCheckResults('upstream', inst, []);
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
        await notifications.notifyCheckResults('upstream', inst, []);
        delivery.resolve();
        await sending;
        await observe(false);
        await observe(true);
        expect(titles()).toEqual(['Upstream offline']);
    });

    it('stops delivering once the instance is removed', async () => {
        await observe(true);
        sendWebhook.mockRejectedValue(new Error('provider failed'));
        await observe(false);
        instances.splice(0, 1);
        try {
            await vi.advanceTimersByTimeAsync(120_000);
            expect(sendWebhook).toHaveBeenCalledTimes(1);
        } finally {
            instances.unshift(inst);
        }
    });

    it.each([true, false])('releases instance history and pending work with delivered=%s', async delivered => {
        await observe(true);
        if (!delivered) {
            sendWebhook.mockRejectedValueOnce(new Error('provider failed'));
        }
        await observe(false);
        notifications.forgetInstanceNotifications(inst.id);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(titles()).toEqual(['Upstream offline']);
        await observe(false);
        await observe(true);
        await observe(false);
        expect(titles()).toEqual(['Upstream offline', 'Upstream offline']);
    });

    it('does not release a different instance with a similar id prefix', async () => {
        const other = instances[1];
        await observe(true, other);
        await observe(false, other);
        notifications.forgetInstanceNotifications(inst.id);
        await observe(true, other);
        expect(titles()).toEqual(['Upstream offline', 'Upstream recovered']);
    });
});

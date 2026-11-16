import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationsFixture } from './fixtures/notifications.mjs';

const { sendWebhook } = vi.hoisted(() => ({ sendWebhook: vi.fn() }));
vi.mock('../src/webhookTransport.js', () => ({ sendWebhook }));

const instances = vi.hoisted(() => [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]);
vi.mock('../src/instances.js', () => ({ getInstances: () => instances }));

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../src/logger.js', () => ({ default: logger }));

const triggers = overrides => ({
    upstreamOffline: false, upstreamOnline: false, routeOffline: false, routeOnline: false,
    certExpiring: false, updateAvailable: false, apiTokenExpiring: false, authentication: false, ...overrides,
});
const config = (overrides = {}) => ({
    enabled: true, provider: 'ntfy', ntfy: { url: 'http://ntfy/caddy-alerts' }, debounceMinutes: 30, ...overrides,
    triggers: triggers(overrides.triggers),
});
const titles = () => sendWebhook.mock.calls.map(([, request]) => request.headers.Title);

describe('sendNotification', () => {
    async function loadNotifications() {
        vi.resetModules();
        return import('../src/notificationDelivery.js');
    }

    beforeEach(() => {
        sendWebhook.mockReset().mockResolvedValue(undefined);
    });

    it('throws for unknown provider', async () => {
        const { sendNotification } = await loadNotifications();
        await expect(
            sendNotification({ provider: 'unknown' }, { title: 'Test', message: 'msg', priority: 'default' })
        ).rejects.toThrow('Unknown provider: unknown');
    });

    it.each([
        ['ntfy', { ntfy: {} }, 'ntfy URL not configured'],
        ['discord', { discord: {} }, 'Discord webhook URL not configured'],
        ['slack', { slack: {} }, 'Slack webhook URL not configured'],
        ['pushover', { pushover: {} }, 'Pushover user key and API token required'],
        ['custom', { custom: {} }, 'Custom webhook URL not configured'],
    ])('throws when %s is not configured', async (provider, settings, error) => {
        const { sendNotification } = await loadNotifications();
        await expect(
            sendNotification({ provider, ...settings }, { title: 'Test', message: 'msg', priority: 'default' })
        ).rejects.toThrow(error);
        expect(sendWebhook).not.toHaveBeenCalled();
    });

    it('sends ntfy notification with title and priority headers', async () => {
        const { sendNotification } = await loadNotifications();
        await sendNotification(
            { provider: 'ntfy', ntfy: { url: 'http://ntfy/caddy-alerts' } },
            { title: 'Alert', message: 'Something happened', priority: 'high' }
        );

        const [url, request] = sendWebhook.mock.calls[0];
        expect(url).toBe('http://ntfy/caddy-alerts');
        expect(request.body).toBe('Something happened');
        expect(request.headers.Title).toBe('Alert');
        expect(request.headers.Priority).toBe('high');
    });

    it('propagates delivery failures', async () => {
        const { sendNotification } = await loadNotifications();
        sendWebhook.mockRejectedValue(new Error('ntfy responded 500: Internal error'));

        await expect(
            sendNotification(
                { provider: 'ntfy', ntfy: { url: 'https://ntfy.example.com/topic' } },
                { title: 'Test', message: 'msg', priority: 'default' }
            )
        ).rejects.toThrow('ntfy responded 500');
    });

    it('sends discord notification with correct embed structure', async () => {
        const { sendNotification } = await loadNotifications();
        await sendNotification(
            { provider: 'discord', discord: { webhookUrl: 'https://discord.com/api/webhooks/1/abc' } },
            { title: 'Alert', message: 'Down', priority: 'high' }
        );

        const body = JSON.parse(sendWebhook.mock.calls[0][1].body);
        expect(body.embeds[0].title).toBe('Alert');
        expect(body.embeds[0].description).toBe('Down');
        expect(body.embeds[0].color).toBe(0xff4d6a);
        expect(body.embeds[0].footer.text).toBe('caddy/ui');
    });

    it('sends discord with green color for non-high priority', async () => {
        const { sendNotification } = await loadNotifications();
        await sendNotification(
            { provider: 'discord', discord: { webhookUrl: 'https://discord.com/api/webhooks/1/abc' } },
            { title: 'Recovered', message: 'Up', priority: 'default' }
        );

        expect(JSON.parse(sendWebhook.mock.calls[0][1].body).embeds[0].color).toBe(0x00e5a0);
    });

    it('sends slack notification with emoji prefix', async () => {
        const { sendNotification } = await loadNotifications();
        await sendNotification(
            { provider: 'slack', slack: { webhookUrl: 'https://hooks.slack.com/services/x' } },
            { title: 'Alert', message: 'Down', priority: 'high' }
        );

        expect(JSON.parse(sendWebhook.mock.calls[0][1].body).text).toBe(':rotating_light: *Alert*\nDown');
    });

    it('sends slack with checkmark for non-high priority', async () => {
        const { sendNotification } = await loadNotifications();
        await sendNotification(
            { provider: 'slack', slack: { webhookUrl: 'https://hooks.slack.com/services/x' } },
            { title: 'OK', message: 'Up', priority: 'default' }
        );

        expect(JSON.parse(sendWebhook.mock.calls[0][1].body).text).toMatch(/^:white_check_mark:/);
    });

    it('sends pushover notification with correct fields', async () => {
        const { sendNotification } = await loadNotifications();
        await sendNotification(
            { provider: 'pushover', pushover: { userKey: 'ukey', apiToken: 'atoken' } },
            { title: 'Alert', message: 'msg', priority: 'high' }
        );

        const [url, request] = sendWebhook.mock.calls[0];
        expect(url).toBe('https://api.pushover.net/1/messages.json');
        const body = JSON.parse(request.body);
        expect(body.token).toBe('atoken');
        expect(body.user).toBe('ukey');
        expect(body.title).toBe('Alert');
        expect(body.priority).toBe(1);
    });

    it('sends custom webhook with correct structure', async () => {
        const { sendNotification } = await loadNotifications();
        await sendNotification(
            { provider: 'custom', custom: { url: 'http://192.168.1.50/hook', method: 'PUT' } },
            { title: 'Custom', message: 'test', priority: 'default' }
        );

        const [url, request] = sendWebhook.mock.calls[0];
        expect(url).toBe('http://192.168.1.50/hook');
        expect(request.method).toBe('PUT');
        const body = JSON.parse(request.body);
        expect(body.title).toBe('Custom');
        expect(body.message).toBe('test');
    });

    it('custom webhook defaults to POST method', async () => {
        const { sendNotification } = await loadNotifications();
        await sendNotification(
            { provider: 'custom', custom: { url: 'https://webhook.example.com' } },
            { title: 'Custom', message: 'test', priority: 'default' }
        );

        expect(sendWebhook.mock.calls[0][1].method).toBe('POST');
    });
});

describe('route transitions', () => {
    const check = (host, online) => ({ target: host, online, label: host, failure: online ? undefined : 'HTTP 502' });
    let notifications;

    beforeEach(async () => {
        sendWebhook.mockReset().mockResolvedValue(undefined);
        notifications = await notificationsFixture({ config: config({ triggers: { routeOffline: true, routeOnline: true } }) });
    });

    afterEach(() => notifications.close());

    const observe = (inst, ...checks) => notifications.notifyCheckResults('route', inst, checks);

    it('reports nothing on the first round', async () => {
        await observe(instances[0], check('x.example.com', true), check('y.example.com', false));
        expect(sendWebhook).not.toHaveBeenCalled();
    });

    it('reports routes whose state changed since the last round, with why they failed', async () => {
        await observe(instances[0], check('x.example.com', true));
        await observe(instances[0], check('x.example.com', false));
        await observe(instances[0], check('x.example.com', false));
        await observe(instances[0], check('x.example.com', true));
        expect(titles()).toEqual(['Route down', 'Route recovered']);
        expect(sendWebhook.mock.calls[0][1].body).toBe('[Alpha] x.example.com is down: HTTP 502');
    });

    it('does not announce a recovery nobody was told about', async () => {
        await observe(instances[0], check('y.example.com', false));
        await observe(instances[0], check('y.example.com', true));
        expect(sendWebhook).not.toHaveBeenCalled();
    });

    it('forgets routes missing from a round so they do not fire when they return', async () => {
        await observe(instances[0], check('x.example.com', true));
        await observe(instances[0]);
        await observe(instances[0], check('x.example.com', false));
        expect(sendWebhook).not.toHaveBeenCalled();
    });

    it('keeps instances and kinds separate', async () => {
        await observe(instances[0], check('x.example.com', true));
        await observe(instances[1], check('x.example.com', false));
        await notifications.notifyCheckResults('upstream', instances[0], [{ target: 'x.example.com', online: false, label: 'x.example.com' }]);
        await observe(instances[0], check('x.example.com', true));
        expect(sendWebhook).not.toHaveBeenCalled();
    });
});

describe('upstream transitions', () => {
    const inst = instances[0];
    const check = (target, online) => ({ target, online, label: target });
    const upstreamConfig = enabled => config({ enabled, triggers: { upstreamOffline: true, upstreamOnline: true } });
    let notifications;

    beforeEach(async () => {
        sendWebhook.mockReset().mockResolvedValue(undefined);
        notifications = await notificationsFixture({ config: upstreamConfig(true) });
    });

    afterEach(() => notifications.close());

    const observe = (...checks) => notifications.notifyCheckResults('upstream', inst, checks);

    it('alerts on transitions in the monitor rounds it is given, not on the first', async () => {
        await observe(check('app:3000', true));
        expect(sendWebhook).not.toHaveBeenCalled();
        await observe(check('app:3000', false));
        expect(titles()).toEqual(['Upstream offline']);
        expect(sendWebhook.mock.calls[0][1].body).toBe('[Alpha] app:3000 is unreachable');
    });

    it('continues sending Upstream offline alerts after one delivery fails', async () => {
        await observe(check('first:3000', true), check('second:3000', true));
        sendWebhook.mockRejectedValueOnce(new Error('ntfy responded 500'));
        const changed = [check('first:3000', false), check('second:3000', false)];

        await expect(observe(...changed)).resolves.toBeUndefined();
        expect(titles()).toEqual(['Upstream offline', 'Upstream offline']);
        expect(sendWebhook.mock.calls[1][1].body).toContain('second:3000');

        await observe(...changed);
        expect(sendWebhook).toHaveBeenCalledTimes(2);
    });

    it('continues sending Upstream recovered alerts after one delivery fails', async () => {
        await observe(check('first:3000', true), check('second:3000', true));
        await observe(check('first:3000', false), check('second:3000', false));
        sendWebhook.mockClear().mockRejectedValueOnce(new Error('ntfy responded 500'));
        const changed = [check('first:3000', true), check('second:3000', true)];

        await expect(observe(...changed)).resolves.toBeUndefined();
        expect(titles()).toEqual(['Upstream recovered', 'Upstream recovered']);
        expect(sendWebhook.mock.calls[1][1].body).toContain('second:3000');

        await observe(...changed);
        expect(sendWebhook).toHaveBeenCalledTimes(2);
    });

    it('tracks state while off, so turning alerts on does not report an old transition', async () => {
        await notifications.configure(upstreamConfig(false));
        await observe(check('app:3000', true));
        await observe(check('app:3000', false));
        await notifications.configure(upstreamConfig(true));
        await observe(check('app:3000', false));
        expect(sendWebhook).not.toHaveBeenCalled();
    });

    it('debounces repeated outages of the same upstream', async () => {
        await observe(check('app:3000', true));
        await observe(check('app:3000', false));
        await observe(check('app:3000', true));
        await observe(check('app:3000', false));
        expect(titles()).toEqual(['Upstream offline', 'Upstream recovered']);
    });

    it('leaves the instance name out with a single instance', async () => {
        const removed = instances.splice(1);
        try {
            await observe(check('app:3000', true));
            await observe(check('app:3000', false));
            expect(sendWebhook.mock.calls[0][1].body).toBe('app:3000 is unreachable');
        } finally {
            instances.push(...removed);
        }
    });
});

describe('API token expiry reminders', () => {
    const DAY = 86_400_000;
    const now = Date.parse('2026-10-18T12:00:00Z');
    const token = (id, lifetimeDays, remainingDays) => ({
        id, name: `Token ${id}`,
        createdAt: new Date(now - (lifetimeDays - remainingDays) * DAY).toISOString(),
        expiresAt: new Date(now + remainingDays * DAY).toISOString(),
    });
    let notifications;
    let tokens;

    // Enabling notifications starts a round right away; runReminders joins it.
    async function load() {
        notifications = await notificationsFixture({ config: config({ triggers: { apiTokenExpiring: true } }), apiTokens: () => tokens });
        return notifications;
    }

    beforeEach(() => {
        vi.useFakeTimers({ now });
        sendWebhook.mockReset().mockResolvedValue(undefined);
        tokens = [token('a', 90, 6.5)];
    });

    afterEach(async () => {
        await notifications.close();
        vi.useRealTimers();
    });

    it('alerts once per token when 7 days or less remain', async () => {
        const { runReminders } = await load();
        await runReminders();
        await runReminders();
        expect(sendWebhook).toHaveBeenCalledTimes(1);
        const [, request] = sendWebhook.mock.calls[0];
        expect(request.headers.Title).toBe('API token expiring');
        expect(request.body).toBe('API token "Token a" expires in 7 days (2026-10-25)');
    });

    it.each(['ntfy responded 500', 'ntfy request timed out'])('retries the next round after delivery fails: %s', async message => {
        const error = logger.error.mockClear();
        sendWebhook.mockRejectedValueOnce(new Error(message));
        const { runReminders } = await load();
        await runReminders();
        expect(error).toHaveBeenCalledWith('Notification check failed', { category: 'api-tokens', error: message });
        await runReminders();
        await runReminders();
        expect(sendWebhook).toHaveBeenCalledTimes(2);
    });

    it.each(['success', 'failure'])('does not start an overlapping round while delivery is pending, then handles %s', async outcome => {
        let finish;
        sendWebhook.mockImplementationOnce(() => new Promise((resolve, reject) => {
            finish = () => outcome === 'success' ? resolve() : reject(new Error('ntfy request timed out'));
        }));
        const { runReminders } = await load();
        const round = runReminders();
        expect(runReminders()).toBe(round);
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(sendWebhook).toHaveBeenCalledTimes(1);
        finish();
        await round;
        await runReminders();
        expect(sendWebhook).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 2);
    });

    it('skips tokens outside the window, already expired, or short-lived by choice', async () => {
        tokens = [token('far', 90, 8), token('gone', 90, -1), token('short', 7, 3)];
        const { runReminders } = await load();
        await runReminders();
        expect(sendWebhook).not.toHaveBeenCalled();
    });
});

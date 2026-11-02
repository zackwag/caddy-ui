import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendWebhook } = vi.hoisted(() => ({ sendWebhook: vi.fn() }));
vi.mock('../src/webhookTransport.js', () => ({ sendWebhook }));

describe('sendNotification', () => {
    async function loadNotifications() {
        vi.resetModules();
        return import('../src/notifications.js');
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

describe('routeTransitions', () => {
    async function load() {
        vi.resetModules();
        return import('../src/notifications.js');
    }

    const check = (host, online) => ({ host, online, statusCode: online ? 200 : 502, error: null });

    it('reports nothing on the first round', async () => {
        const { routeTransitions } = await load();
        const state = new Map();
        expect(routeTransitions(state, 'a', [check('x.example.com', true), check('y.example.com', false)])).toEqual([]);
    });

    it('reports routes whose state changed since the last round', async () => {
        const { routeTransitions } = await load();
        const state = new Map();
        routeTransitions(state, 'a', [check('x.example.com', true), check('y.example.com', false)]);
        const changes = routeTransitions(state, 'a', [check('x.example.com', false), check('y.example.com', true)]);
        expect(changes.map(c => [c.host, c.online])).toEqual([['x.example.com', false], ['y.example.com', true]]);
        expect(routeTransitions(state, 'a', [check('x.example.com', false), check('y.example.com', true)])).toEqual([]);
    });

    it('forgets routes missing from a round so they do not fire when they return', async () => {
        const { routeTransitions } = await load();
        const state = new Map();
        routeTransitions(state, 'a', [check('x.example.com', true)]);
        routeTransitions(state, 'a', []);
        expect(routeTransitions(state, 'a', [check('x.example.com', false)])).toEqual([]);
    });

    it('keeps instances separate', async () => {
        const { routeTransitions } = await load();
        const state = new Map();
        routeTransitions(state, 'a', [check('x.example.com', true)]);
        routeTransitions(state, 'b', [check('x.example.com', false)]);
        expect(routeTransitions(state, 'a', [check('x.example.com', true)])).toEqual([]);
        expect(state.get('b#x.example.com')).toBe(false);
    });
});

describe('notifyUpstreamChecks', () => {
    const inst = { id: 'a', name: 'Alpha' };
    const check = (upstream, online) => ({ domain: 'app.example.com', upstream, online });
    const config = enabled => ({
        enabled, provider: 'ntfy', ntfy: { url: 'http://ntfy/caddy-alerts' }, debounceMinutes: 30,
        triggers: { upstreamOffline: true, upstreamOnline: true, certExpiring: false, updateAvailable: false },
    });

    async function load() {
        vi.resetModules();
        return import('../src/notifications.js');
    }

    beforeEach(() => {
        sendWebhook.mockReset().mockResolvedValue(undefined);
    });

    it('alerts on transitions in the monitor rounds it is given, not on the first', async () => {
        const { notifyUpstreamChecks, updateMonitorConfig } = await load();
        updateMonitorConfig(config(true));
        try {
            await notifyUpstreamChecks(inst, [check('app:3000', true)]);
            expect(sendWebhook).not.toHaveBeenCalled();
            await notifyUpstreamChecks(inst, [check('app:3000', false)]);
            expect(sendWebhook).toHaveBeenCalledTimes(1);
            expect(sendWebhook.mock.calls[0][1].headers.Title).toBe('Upstream offline');
        } finally {
            updateMonitorConfig(config(false));
        }
    });

    it('continues sending Upstream offline alerts after one delivery fails', async () => {
        const { notifyUpstreamChecks, updateMonitorConfig } = await load();
        updateMonitorConfig(config(true));
        try {
            await notifyUpstreamChecks(inst, [check('first:3000', true), check('second:3000', true)]);
            sendWebhook.mockRejectedValueOnce(new Error('ntfy responded 500'));
            const changed = [check('first:3000', false), check('second:3000', false)];

            await expect(notifyUpstreamChecks(inst, changed)).resolves.toBeUndefined();
            expect(sendWebhook).toHaveBeenCalledTimes(2);
            expect(sendWebhook.mock.calls[1][1].headers.Title).toBe('Upstream offline');
            expect(sendWebhook.mock.calls[1][1].body).toContain('second:3000');

            await notifyUpstreamChecks(inst, changed);
            expect(sendWebhook).toHaveBeenCalledTimes(2);
        } finally {
            updateMonitorConfig(config(false));
        }
    });

    it('continues sending Upstream recovered alerts after one delivery fails', async () => {
        const { notifyUpstreamChecks, updateMonitorConfig, _test } = await load();
        updateMonitorConfig(config(true));
        try {
            // Seed delivered offline state so recovery gate passes
            _test.deliveredOffline.add(`${inst.id}:first:3000`);
            _test.deliveredOffline.add(`${inst.id}:second:3000`);
            await notifyUpstreamChecks(inst, [check('first:3000', false), check('second:3000', false)]);
            sendWebhook.mockRejectedValueOnce(new Error('ntfy responded 500'));
            const changed = [check('first:3000', true), check('second:3000', true)];

            await expect(notifyUpstreamChecks(inst, changed)).resolves.toBeUndefined();
            expect(sendWebhook).toHaveBeenCalledTimes(2);
            expect(sendWebhook.mock.calls[1][1].headers.Title).toBe('Upstream recovered');
            expect(sendWebhook.mock.calls[1][1].body).toContain('second:3000');

            await notifyUpstreamChecks(inst, changed);
            expect(sendWebhook).toHaveBeenCalledTimes(2);
        } finally {
            updateMonitorConfig(config(false));
        }
    });

    it('tracks state while off, so turning alerts on does not report an old transition', async () => {
        const { notifyUpstreamChecks, updateMonitorConfig } = await load();
        await notifyUpstreamChecks(inst, [check('app:3000', true)]);
        await notifyUpstreamChecks(inst, [check('app:3000', false)]);
        updateMonitorConfig(config(true));
        try {
            await notifyUpstreamChecks(inst, [check('app:3000', false)]);
            expect(sendWebhook).not.toHaveBeenCalled();
        } finally {
            updateMonitorConfig(config(false));
        }
    });
});

describe('notifyExpiringApiTokens', () => {
    const DAY = 86_400_000;
    const now = Date.parse('2026-10-18T12:00:00Z');
    const token = (id, lifetimeDays, remainingDays) => ({
        id, name: `Token ${id}`,
        createdAt: new Date(now - (lifetimeDays - remainingDays) * DAY).toISOString(),
        expiresAt: new Date(now + remainingDays * DAY).toISOString(),
    });
    const config = enabled => ({
        enabled, provider: 'ntfy', ntfy: { url: 'http://ntfy/caddy-alerts' }, debounceMinutes: 30,
        triggers: { upstreamOffline: false, upstreamOnline: false, certExpiring: false, updateAvailable: false, apiTokenExpiring: true },
    });

    async function load() {
        vi.resetModules();
        const notifications = await import('../src/notifications.js');
        notifications.updateMonitorConfig(config(true));
        return notifications;
    }

    beforeEach(() => {
        sendWebhook.mockReset().mockResolvedValue(undefined);
    });

    it('alerts once per token when 7 days or less remain', async () => {
        const { notifyExpiringApiTokens, updateMonitorConfig } = await load();
        try {
            await notifyExpiringApiTokens([token('a', 90, 6.5)], now);
            await notifyExpiringApiTokens([token('a', 90, 6.5)], now);
            expect(sendWebhook).toHaveBeenCalledTimes(1);
            const [, request] = sendWebhook.mock.calls[0];
            expect(request.headers.Title).toBe('API token expiring');
            expect(request.body).toBe('API token "Token a" expires in 7 days (2026-10-25)');
        } finally {
            updateMonitorConfig(config(false));
        }
    });

    it.each(['ntfy responded 500', 'ntfy request timed out'])('retries after delivery fails: %s', async message => {
        const { notifyExpiringApiTokens, updateMonitorConfig } = await load();
        const tokens = [token('a', 90, 6.5)];
        const error = new Error(message);
        sendWebhook.mockRejectedValueOnce(error);
        try {
            await expect(notifyExpiringApiTokens(tokens, now)).rejects.toBe(error);
            await notifyExpiringApiTokens(tokens, now + 30_000);
            await notifyExpiringApiTokens(tokens, now + 60_000);
            expect(sendWebhook).toHaveBeenCalledTimes(2);
        } finally {
            updateMonitorConfig(config(false));
        }
    });

    it.each(['success', 'failure'])('suppresses overlapping sends while delivery is pending, then handles %s', async outcome => {
        const { notifyExpiringApiTokens, updateMonitorConfig } = await load();
        const tokens = [token('a', 90, 6.5)];
        const error = new Error('ntfy request timed out');
        let finish;
        sendWebhook.mockImplementationOnce(() => new Promise((resolve, reject) => {
            finish = () => outcome === 'success' ? resolve() : reject(error);
        }));
        const pending = notifyExpiringApiTokens(tokens, now);
        const settled = pending.then(() => undefined, err => err);
        try {
            await notifyExpiringApiTokens(tokens, now + 30_000);
            expect(sendWebhook).toHaveBeenCalledTimes(1);
            finish();
            expect(await settled).toBe(outcome === 'success' ? undefined : error);
            await notifyExpiringApiTokens(tokens, now + 60_000);
            expect(sendWebhook).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 2);
        } finally {
            finish();
            await settled;
            updateMonitorConfig(config(false));
        }
    });

    it('skips tokens outside the window, already expired, or short-lived by choice', async () => {
        const { notifyExpiringApiTokens, updateMonitorConfig } = await load();
        try {
            await notifyExpiringApiTokens([token('far', 90, 8), token('gone', 90, -1), token('short', 7, 3)], now);
            expect(sendWebhook).not.toHaveBeenCalled();
        } finally {
            updateMonitorConfig(config(false));
        }
    });
});

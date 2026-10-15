import { describe, expect, it, vi } from 'vitest';
import { promises as dns } from 'dns';
import { sendNtfy } from '../src/ntfyTransport.js';

vi.mock('../src/ntfyTransport.js', () => ({ sendNtfy: vi.fn() }));

vi.mock('dns', () => ({
    promises: {
        lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
    },
}));

describe('sendNotification', () => {
    async function loadNotifications() {
        vi.resetModules();
        return import('../src/notifications.js');
    }

    it('throws for unknown provider', async () => {
        const { sendNotification } = await loadNotifications();
        await expect(
            sendNotification({ provider: 'unknown' }, { title: 'Test', message: 'msg', priority: 'default' })
        ).rejects.toThrow('Unknown provider: unknown');
    });

    it('throws when ntfy url is not configured', async () => {
        const { sendNotification } = await loadNotifications();
        await expect(
            sendNotification({ provider: 'ntfy', ntfy: {} }, { title: 'Test', message: 'msg', priority: 'default' })
        ).rejects.toThrow('ntfy URL not configured');
    });

    it('throws when discord webhook url is not configured', async () => {
        const { sendNotification } = await loadNotifications();
        await expect(
            sendNotification({ provider: 'discord', discord: {} }, { title: 'Test', message: 'msg', priority: 'default' })
        ).rejects.toThrow('Discord webhook URL not configured');
    });

    it('throws when slack webhook url is not configured', async () => {
        const { sendNotification } = await loadNotifications();
        await expect(
            sendNotification({ provider: 'slack', slack: {} }, { title: 'Test', message: 'msg', priority: 'default' })
        ).rejects.toThrow('Slack webhook URL not configured');
    });

    it('throws when pushover credentials are missing', async () => {
        const { sendNotification } = await loadNotifications();
        await expect(
            sendNotification({ provider: 'pushover', pushover: {} }, { title: 'Test', message: 'msg', priority: 'default' })
        ).rejects.toThrow('Pushover user key and API token required');
    });

    it('throws when custom webhook url is not configured', async () => {
        const { sendNotification } = await loadNotifications();
        await expect(
            sendNotification({ provider: 'custom', custom: {} }, { title: 'Test', message: 'msg', priority: 'default' })
        ).rejects.toThrow('Custom webhook URL not configured');
    });

    it('delegates ntfy delivery to the address-pinned sender', async () => {
        const { sendNotification } = await loadNotifications();
        sendNtfy.mockResolvedValueOnce(undefined);
        await sendNotification(
            { provider: 'ntfy', ntfy: { url: 'https://ntfy.example.com/topic' } },
            { title: 'Alert', message: 'Something happened', priority: 'high' }
        );
        expect(sendNtfy).toHaveBeenLastCalledWith('https://ntfy.example.com/topic', {
            title: 'Alert', message: 'Something happened', priority: 'high',
        });
    });

    it('propagates ntfy delivery failures', async () => {
        const { sendNotification } = await loadNotifications();
        sendNtfy.mockRejectedValueOnce(new Error('ntfy responded 500'));
        await expect(sendNotification(
            { provider: 'ntfy', ntfy: { url: 'https://ntfy.example.com/topic' } },
            { title: 'Test', message: 'msg', priority: 'default' }
        )).rejects.toThrow('ntfy responded 500');
    });

    it.each([
        ['discord', { discord: { webhookUrl: 'http://ntfy.internal/topic' } }],
        ['slack', { slack: { webhookUrl: 'http://ntfy.internal/topic' } }],
        ['custom', { custom: { url: 'http://ntfy.internal/topic' } }],
    ])('does not grant the ntfy exception to %s', async (provider, settings) => {
        vi.stubEnv('CADDY_UI_NTFY_ALLOWED_INTERNAL_URLS', '["http://ntfy.internal/topic"]');
        vi.stubEnv('CADDY_UI_NTFY_ALLOWED_INTERNAL_NETWORKS', '["10.0.0.0/8"]');
        dns.lookup.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);
        try {
            const { sendNotification } = await loadNotifications();
            await expect(sendNotification({ provider, ...settings }, { title: 'Alert', message: 'message' }))
                .rejects.toThrow('internal/private');
        } finally {
            vi.unstubAllEnvs();
            dns.lookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
        }
    });

    it('sends discord notification with correct embed structure', async () => {
        const { sendNotification } = await loadNotifications();
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', mockFetch);

        await sendNotification(
            { provider: 'discord', discord: { webhookUrl: 'https://discord.com/api/webhooks/123' } },
            { title: 'Upstream offline', message: 'app:3000 down', priority: 'high' }
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.embeds[0].title).toBe('Upstream offline');
        expect(body.embeds[0].description).toBe('app:3000 down');
        expect(body.embeds[0].color).toBe(0xff4d6a);
        expect(body.embeds[0].footer.text).toBe('caddy/ui');

        vi.unstubAllGlobals();
    });

    it('sends discord with green color for non-high priority', async () => {
        const { sendNotification } = await loadNotifications();
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', mockFetch);

        await sendNotification(
            { provider: 'discord', discord: { webhookUrl: 'https://discord.com/api/webhooks/123' } },
            { title: 'Recovered', message: 'back online', priority: 'default' }
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.embeds[0].color).toBe(0x00e5a0);

        vi.unstubAllGlobals();
    });

    it('sends slack notification with emoji prefix', async () => {
        const { sendNotification } = await loadNotifications();
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', mockFetch);

        await sendNotification(
            { provider: 'slack', slack: { webhookUrl: 'https://hooks.slack.com/services/abc' } },
            { title: 'Alert', message: 'msg', priority: 'high' }
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.text).toContain(':rotating_light:');
        expect(body.text).toContain('*Alert*');

        vi.unstubAllGlobals();
    });

    it('sends slack with checkmark for non-high priority', async () => {
        const { sendNotification } = await loadNotifications();
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', mockFetch);

        await sendNotification(
            { provider: 'slack', slack: { webhookUrl: 'https://hooks.slack.com/services/abc' } },
            { title: 'OK', message: 'fine', priority: 'default' }
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.text).toContain(':white_check_mark:');

        vi.unstubAllGlobals();
    });

    it('sends pushover notification with correct fields', async () => {
        const { sendNotification } = await loadNotifications();
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', mockFetch);

        await sendNotification(
            { provider: 'pushover', pushover: { userKey: 'ukey', apiToken: 'atoken' } },
            { title: 'Alert', message: 'msg', priority: 'high' }
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.token).toBe('atoken');
        expect(body.user).toBe('ukey');
        expect(body.title).toBe('Alert');
        expect(body.priority).toBe(1);

        vi.unstubAllGlobals();
    });

    it('sends custom webhook with correct structure', async () => {
        const { sendNotification } = await loadNotifications();
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', mockFetch);

        await sendNotification(
            { provider: 'custom', custom: { url: 'https://webhook.example.com', method: 'PUT' } },
            { title: 'Custom', message: 'test', priority: 'default' }
        );

        expect(mockFetch.mock.calls[0][0]).toBe('https://webhook.example.com/');
        expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.title).toBe('Custom');
        expect(body.message).toBe('test');

        vi.unstubAllGlobals();
    });

    it('custom webhook defaults to POST method', async () => {
        const { sendNotification } = await loadNotifications();
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', mockFetch);

        await sendNotification(
            { provider: 'custom', custom: { url: 'https://webhook.example.com' } },
            { title: 'Custom', message: 'test', priority: 'default' }
        );

        expect(mockFetch.mock.calls[0][1].method).toBe('POST');

        vi.unstubAllGlobals();
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

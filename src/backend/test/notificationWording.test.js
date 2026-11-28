import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationsFixture } from './fixtures/notifications.mjs';

// The exact title, message and priority of every notification caddy/ui sends
// with no customization, as delivered.

const { sendWebhook } = vi.hoisted(() => ({ sendWebhook: vi.fn() }));
vi.mock('../src/webhookTransport.js', () => ({ sendWebhook }));
const instances = vi.hoisted(() => []);
vi.mock('../src/instances.js', () => ({ getInstances: () => instances }));
const { listCertificates } = vi.hoisted(() => ({ listCertificates: vi.fn() }));
vi.mock('../src/certificates.js', async importOriginal => ({ ...await importOriginal(), listCertificates }));
const { getUpdateInfo } = vi.hoisted(() => ({ getUpdateInfo: vi.fn() }));
vi.mock('../src/updateCheck.js', async importOriginal => {
    const actual = await importOriginal();
    return { ...actual, getUpdateNotification: () => actual.updateNotification(getUpdateInfo(), { backend: 'v3.10.0', frontend: 'v3.10.0' }) };
});
vi.mock('../src/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const alpha = { id: 'a', name: 'Alpha' };
const beta = { id: 'b', name: 'Beta' };
const ALL_TRIGGERS = ['upstreamOffline', 'upstreamOnline', 'routeOffline', 'routeOnline', 'certExpiring', 'updateAvailable', 'apiTokenExpiring', 'authentication', 'configurationChange'];
const config = on => ({ enabled: true, provider: 'ntfy', ntfy: { url: 'https://ntfy.example.com/caddy' }, debounceMinutes: 1,
    triggers: Object.fromEntries(ALL_TRIGGERS.map(trigger => [trigger, on.includes(trigger)])) });
const sent = () => sendWebhook.mock.calls.map(([, request]) => ({ title: request.headers.Title, message: request.body, priority: request.headers.Priority }));

let notifications;
const load = async (on, options = {}) => {
    notifications = await notificationsFixture({ config: config(on), ...options });
    await vi.advanceTimersByTimeAsync(0);
    sendWebhook.mockClear();
};

beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse('2026-11-28T12:00:00Z') });
    sendWebhook.mockReset().mockResolvedValue(undefined);
    instances.splice(0, instances.length, alpha);
    listCertificates.mockReset().mockResolvedValue([]);
    getUpdateInfo.mockReset().mockReturnValue(null);
});
afterEach(async () => {
    await notifications?.close();
    notifications = null;
    vi.useRealTimers();
});

describe('notification wording', () => {
    it.each([
        ['one instance', [alpha], ''],
        ['several instances', [alpha, beta], '[Alpha] '],
    ])('upstream transitions with %s', async (_, list, prefix) => {
        instances.splice(0, instances.length, ...list);
        await load(['upstreamOffline', 'upstreamOnline']);
        const check = online => ({ target: '10.0.0.5:8080', online, label: 'app.example.com (10.0.0.5:8080)' });
        for (const online of [true, false, true]) {
            await notifications.notifyCheckResults('upstream', alpha, [check(online)]);
        }
        expect(sent()).toEqual([
            { title: 'Upstream offline', message: `${prefix}app.example.com (10.0.0.5:8080) is unreachable`, priority: 'high' },
            { title: 'Upstream recovered', message: `${prefix}app.example.com (10.0.0.5:8080) is back online`, priority: 'default' },
        ]);
    });

    it('route transitions', async () => {
        await load(['routeOffline', 'routeOnline']);
        const check = online => ({ target: 'app.example.com', online, label: 'app.example.com', failure: online ? null : 'HTTP 502' });
        for (const online of [true, false, true]) {
            await notifications.notifyCheckResults('route', alpha, [check(online)]);
        }
        expect(sent()).toEqual([
            { title: 'Route down', message: 'app.example.com is down: HTTP 502', priority: 'high' },
            { title: 'Route recovered', message: 'app.example.com is back up', priority: 'default' },
        ]);
    });

    it.each([
        [1, '1 day'],
        [3, '3 days'],
    ])('certificate expiring in %s days', async (days, expiresIn) => {
        instances.splice(0, instances.length, alpha, beta);
        listCertificates.mockImplementation(async inst => (inst.id === 'a' ? [{ domain: 'wildcard_.example.com', status: 'expiring', daysRemaining: days }] : []));
        await load([]);
        await notifications.configure(config(['certExpiring']));
        await notifications.runReminders();
        expect(sent()).toEqual([{ title: 'Certificate expiring', message: `[Alpha] *.example.com expires in ${expiresIn}`, priority: 'high' }]);
    });

    it('update available', async () => {
        getUpdateInfo.mockReturnValue({ backend: 'v3.11.0', frontend: 'v3.11.0' });
        await load([]);
        await notifications.configure(config(['updateAvailable']));
        await notifications.runReminders();
        expect(sent()).toEqual([{
            title: 'caddy/ui update available',
            message: 'backend v3.10.0 → v3.11.0, frontend v3.10.0 → v3.11.0. Release notes: https://github.com/zackwag/caddy-ui/releases',
            priority: 'default',
        }]);
    });

    it.each([
        [1.5, '2 days (2026-11-30)'],
        [0.5, '1 day (2026-11-29)'],
    ])('API token expiring with %s days left', async (days, expires) => {
        const now = Date.now();
        const token = { id: 't1', name: 'Home Assistant', createdAt: new Date(now - 80 * 86_400_000).toISOString(), expiresAt: new Date(now + days * 86_400_000).toISOString() };
        await load([], { apiTokens: () => [token] });
        await notifications.configure(config(['apiTokenExpiring']));
        await notifications.runReminders();
        expect(sent()).toEqual([{ title: 'API token expiring', message: `API token "Home Assistant" expires in ${expires}`, priority: 'high' }]);
    });

    describe('authentication', () => {
        const sign = async (method, outcome, passkeysConfigured = false, ip = '192.0.2.10') => {
            notifications.recordAuthentication({ ip }, method, outcome, passkeysConfigured);
            await vi.advanceTimersByTimeAsync(0);
        };
        const details = (method, outcome, ip = '192.0.2.10') => `Time: 2026-11-28T12:00:00.000Z\nMethod: ${method}\nOutcome: ${outcome}\nSource IP: ${ip}`;

        it.each([
            ['password', 'success', false, 'Password sign-in succeeded', 'default'],
            ['password-totp', 'success', false, 'Password and authenticator sign-in succeeded', 'default'],
            ['passkey', 'failure', false, 'Passkey sign-in failed', 'default'],
            ['totp', 'failure', false, 'Authenticator sign-in failed', 'default'],
            ['password', 'success', true, 'Password sign-in while passkeys are configured', 'high'],
            ['recovery', 'success', false, 'Account recovery succeeded', 'high'],
            ['recovery', 'failure', false, 'Account recovery failed', 'high'],
        ])('%s %s (passkeys: %s)', async (method, outcome, passkeysConfigured, title, priority) => {
            await load(['authentication']);
            await sign(method, outcome, passkeysConfigured);
            expect(sent()).toEqual([{ title, message: details(method, outcome), priority }]);
        });

        it.each([
            ['password', 'Password sign-in failed', 'default'],
            ['recovery', 'Account recovery failed', 'high'],
        ])('a %s failure summary after the cooldown', async (method, title, priority) => {
            await load(['authentication']);
            await sign(method, 'failure');
            await sign(method, 'failure', false, '192.0.2.11');
            await sign(method, 'failure', false, '192.0.2.12');
            await vi.advanceTimersByTimeAsync(60_000);
            expect(sent().at(-1)).toEqual({
                title,
                message: `2 additional failed ${method} attempts during the cooldown. Latest attempt: 2026-11-28T12:00:00.000Z. Latest source IP: 192.0.2.12.`,
                priority,
            });
        });
    });

    describe('configuration changes', () => {
        const change = overrides => ({ instanceId: 'a', instanceName: 'Alpha', representations: ['file', 'live'],
            detectedAt: '2026-11-28T12:00:00.000Z', historyEntry: 'Caddyfile-2026-11-28T12-00-00-000Z-x.json', ...overrides });
        const title = 'Configuration changed outside caddy/ui';

        it.each([
            ['with a history entry', {}, 'Instance: Alpha\nChanged: Caddyfile and live configuration\nDetected: 2026-11-28T12:00:00.000Z\nSource: unknown, outside a tracked caddy/ui operation\nHistory entry: Caddyfile-2026-11-28T12-00-00-000Z-x.json'],
            ['without one', { representations: ['live'], historyEntry: null }, 'Instance: Alpha\nChanged: live configuration\nDetected: 2026-11-28T12:00:00.000Z\nSource: unknown, outside a tracked caddy/ui operation'],
        ])('%s', async (_, overrides, message) => {
            await load(['configurationChange']);
            await notifications.notifyConfigurationChange(change(overrides));
            expect(sent()).toEqual([{ title, message, priority: 'high' }]);
        });

        it('a summary after the cooldown', async () => {
            await load(['configurationChange']);
            await notifications.notifyConfigurationChange(change());
            await notifications.notifyConfigurationChange(change({ detectedAt: '2026-11-28T12:00:10.000Z' }));
            await notifications.notifyConfigurationChange(change({ representations: ['file'], detectedAt: '2026-11-28T12:00:20.000Z', historyEntry: null }));
            await vi.advanceTimersByTimeAsync(60_000);
            expect(sent().at(-1)).toEqual({
                title,
                message: '2 additional unexplained configuration changes on Alpha during the cooldown.\nChanged: Caddyfile\nDetected: 2026-11-28T12:00:20.000Z\nSource: unknown, outside a tracked caddy/ui operation',
                priority: 'high',
            });
        });
    });
});

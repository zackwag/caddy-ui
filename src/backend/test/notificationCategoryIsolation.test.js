import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationsFixture } from './fixtures/notifications.mjs';

const { sendWebhook } = vi.hoisted(() => ({ sendWebhook: vi.fn() }));
vi.mock('../src/webhookTransport.js', () => ({ sendWebhook }));

vi.mock('../src/instances.js', () => ({ getInstances: () => [{ id: 'i1', name: 'Main', adminUrl: 'http://localhost:2019', dataPath: '/data', containerName: '' }] }));

const { listCertificates } = vi.hoisted(() => ({ listCertificates: vi.fn() }));
vi.mock('../src/certificates.js', async importOriginal => ({ ...await importOriginal(), listCertificates }));

vi.mock('../src/updateCheck.js', () => ({
    getUpdateNotification: () => ({ key: 'v9.9.9', title: 'Update available', message: 'v9.9.9 is out' }),
}));

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../src/logger.js', () => ({ default: logger }));

const DAY = 86_400_000;
const expiringToken = () => ({
    id: 't1', name: 'Token', createdAt: new Date(Date.now() - 90 * DAY).toISOString(), expiresAt: new Date(Date.now() + 3 * DAY).toISOString(),
});
const config = {
    enabled: true,
    provider: 'ntfy',
    ntfy: { url: 'http://ntfy/test' },
    debounceMinutes: 30,
    triggers: { upstreamOffline: false, upstreamOnline: false, certExpiring: true, updateAvailable: true, apiTokenExpiring: true },
};
const titles = () => sendWebhook.mock.calls.map(([, request]) => request.headers.Title).sort();

describe('notification category isolation', () => {
    let notifications;

    beforeEach(() => {
        sendWebhook.mockReset().mockResolvedValue(undefined);
        listCertificates.mockReset().mockResolvedValue([{ domain: 'app.example.com', status: 'expiring', daysRemaining: 3 }]);
        logger.error.mockClear();
        logger.warn.mockClear();
    });

    afterEach(() => notifications.close());

    // Enabling notifications starts a round right away; runReminders joins it.
    async function remind() {
        notifications = await notificationsFixture({ config, apiTokens: () => [expiringToken()] });
        await notifications.runReminders();
    }

    it('a category whose delivery fails does not prevent the others from sending', async () => {
        sendWebhook.mockImplementation(async (url, request) => {
            if (request.headers.Title === 'Update available') {
                throw new Error('simulated provider failure');
            }
        });
        await remind();
        expect(titles()).toEqual(['API token expiring', 'Certificate expiring', 'Update available']);
        expect(logger.error).toHaveBeenCalledWith('Notification check failed', { category: 'updates', error: 'simulated provider failure' });
    });

    it('unreadable certificate storage does not prevent the other categories from sending', async () => {
        listCertificates.mockRejectedValue(new Error('simulated cert failure'));
        await remind();
        expect(titles()).toEqual(['API token expiring', 'Update available']);
        expect(logger.warn).toHaveBeenCalledWith('Certificate expiry checks skipped: certificates could not be read', { instance: 'Main', reason: 'simulated cert failure' });
    });
});

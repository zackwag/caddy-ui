import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';

// Fresh notification modules backed by their own configuration file. Callers
// mock delivery (webhookTransport.js) and instances themselves.
export async function notificationsFixture({ config, apiTokens } = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-ui-notifications-'));
    process.env.NOTIFICATIONS_CONFIG_PATH = join(directory, 'notifications.json');
    vi.resetModules();
    const notifications = await import('../../src/notifications.js');
    const { saveNotificationConfig } = await import('../../src/notificationConfig.js');
    const authEvents = await import('../../src/authEvents.js');
    await notifications.initNotifications({ apiTokens });
    if (config) {
        await saveNotificationConfig(config);
    }
    return {
        ...notifications,
        recordAuthentication: authEvents.recordAuthentication,
        configure: saveNotificationConfig,
        async close() {
            await saveNotificationConfig({ enabled: false });
            delete process.env.NOTIFICATIONS_CONFIG_PATH;
            await rm(directory, { recursive: true, force: true });
        },
    };
}

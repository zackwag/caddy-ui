import { Router } from 'express';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import logger from '../logger.js';

const router = Router();
const CONFIG_PATH = process.env.NOTIFICATIONS_CONFIG_PATH || '/etc/caddy-ui/notifications.json';

const DEFAULT_CONFIG = {
    enabled: false,
    provider: 'ntfy',
    ntfy: { url: '' },
    discord: { webhookUrl: '' },
    slack: { webhookUrl: '' },
    pushover: { userKey: '', apiToken: '' },
    custom: { url: '', method: 'POST' },
    triggers: {
        upstreamOffline: true,
        upstreamOnline: true,
        certExpiring: true,
    },
    debounceMinutes: 30,
};

async function loadConfig() {
    try {
        const raw = await readFile(CONFIG_PATH, 'utf8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

async function saveConfig(config) {
    await mkdir(dirname(CONFIG_PATH), { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// GET /api/notifications/config
router.get('/config', async (req, res) => {
    const config = await loadConfig();
    res.json(config);
});

// PUT /api/notifications/config
router.put('/config', async (req, res) => {
    const config = { ...DEFAULT_CONFIG, ...req.body };
    await saveConfig(config);
    logger.info('Notifications config updated', { provider: config.provider, enabled: config.enabled });

    const { updateMonitorConfig } = await import('../notifications.js');
    updateMonitorConfig(config);

    res.json(config);
});

// POST /api/notifications/test
router.post('/test', async (req, res) => {
    const config = await loadConfig();

    if (!config.enabled) {
        return res.status(400).json({ error: 'Notifications are disabled' });
    }

    try {
        const { sendNotification } = await import('../notifications.js');
        await sendNotification(config, {
            title: 'caddy/ui test',
            message: 'Notifications are working correctly.',
            priority: 'low',
        });
        res.json({ ok: true, message: 'Test notification sent' });
    } catch (err) {
        logger.error('Test notification failed', { error: err.message });
        res.status(500).json({ error: `Failed to send: ${err.message}` });
    }
});

export default router;
export { loadConfig };

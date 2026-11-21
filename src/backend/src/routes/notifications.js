import { Router } from 'express';
import { recordAudit } from '../auditLog.js';
import { asAppError } from '../AppError.js';
import { sendAppError } from '../errorReporting.js';
import { getNotificationConfig, saveNotificationConfig } from '../notificationConfig.js';
import { sendNotification } from '../notificationDelivery.js';

const router = Router();

router.get('/config', (req, res) => {
    res.json(getNotificationConfig());
});

router.put('/config', async (req, res) => {
    let config;
    try {
        config = await saveNotificationConfig(req.body);
    } catch (err) {
        await recordAudit(req, { action: 'notifications.configure', outcome: 'failure' });
        throw err;
    }
    // Destinations and credentials stay out of the audit log.
    const triggers = Object.keys(config.triggers).filter(trigger => config.triggers[trigger]);
    await recordAudit(req, { action: 'notifications.configure', details: { enabled: config.enabled, provider: config.provider, triggers } });
    res.json(config);
});

router.post('/test', async (req, res) => {
    const config = getNotificationConfig();
    if (!config.enabled) {
        return res.status(400).json({ error: 'Notifications are disabled' });
    }
    try {
        await sendNotification(config, {
            title: 'caddy/ui test',
            message: 'Notifications are working correctly.',
            priority: 'low',
        });
        res.json({ ok: true, message: 'Test notification sent' });
    } catch (err) {
        // The cause, including the destination's response, goes to the logs only.
        sendAppError(res, asAppError(err, 'NOTIFICATION_SEND_FAILED'));
    }
});

export default router;

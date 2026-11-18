import { Router } from 'express';
import { asAppError } from '../AppError.js';
import { sendAppError } from '../errorReporting.js';
import { getNotificationConfig, saveNotificationConfig } from '../notificationConfig.js';
import { sendNotification } from '../notificationDelivery.js';

const router = Router();

router.get('/config', (req, res) => {
    res.json(getNotificationConfig());
});

router.put('/config', async (req, res) => {
    res.json(await saveNotificationConfig(req.body));
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

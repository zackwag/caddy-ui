import { Router } from 'express';
import { audited } from '../auditLog.js';
import { AppError, asAppError } from '../AppError.js';
import { getNotificationConfig, saveNotificationConfig } from '../notificationConfig.js';
import { sendNotification } from '../notificationDelivery.js';
import { renderNotification } from '../notificationEvents.js';

const router = Router();

router.get('/config', (req, res) => {
    res.json(getNotificationConfig());
});

router.put('/config', async (req, res) => {
    // Destinations and credentials stay out of the audit log.
    const describe = ({ enabled, provider, triggers }) => ({ enabled, provider, triggers: Object.keys(triggers).filter(trigger => triggers[trigger]) });
    const config = await audited(req, { action: 'notifications.configure', details: describe }, () => saveNotificationConfig(req.body));
    res.json(config);
});

router.post('/test', async (req, res) => {
    const config = getNotificationConfig();
    if (!config.enabled) {
        throw new AppError('VALIDATION_FAILED', { context: { field: 'enabled' } });
    }
    try {
        await sendNotification(config, renderNotification('test'));
    } catch (err) {
        // The cause, including the destination's response, goes to the logs only.
        throw asAppError(err, 'NOTIFICATION_SEND_FAILED');
    }
    res.json({ ok: true, message: 'Test notification sent' });
});

export default router;

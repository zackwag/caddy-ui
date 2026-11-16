import { Router } from 'express';
import { runChecks } from '../monitoring.js';
import { InvalidSettingError, getSettings, saveSettings, settingsUpdate } from '../settings.js';

const router = Router();

router.get('/', (req, res) => {
    res.json(getSettings());
});

router.put('/', async (req, res) => {
    let updates;
    try {
        updates = settingsUpdate(req.body);
    } catch (err) {
        if (!(err instanceof InvalidSettingError)) throw err;
        return res.status(400).json({ error: err.message });
    }
    const wasChecking = getSettings().routeChecks;
    const settings = await saveSettings(updates);
    if (settings.routeChecks && !wasChecking) runChecks('route');
    res.json(settings);
});

export default router;

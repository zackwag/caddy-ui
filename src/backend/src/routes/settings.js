import { Router } from 'express';
import { runChecks } from '../monitoring.js';
import { getSettings, saveSettings, settingsUpdate } from '../settings.js';

const router = Router();

router.get('/', (req, res) => {
    res.json(getSettings());
});

router.put('/', async (req, res) => {
    const updates = settingsUpdate(req.body);
    const wasChecking = getSettings().routeChecks;
    const settings = await saveSettings(updates);
    if (settings.routeChecks && !wasChecking) runChecks('route');
    res.json(settings);
});

export default router;

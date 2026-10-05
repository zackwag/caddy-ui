import { Router } from 'express';
import { sanitizeHostList } from '../routeChecks.js';
import { runRouteChecks } from '../routeMonitor.js';
import { getSettings, saveSettings } from '../settings.js';

const router = Router();

router.get('/', (req, res) => {
    res.json(getSettings());
});

router.put('/', async (req, res) => {
    try {
        const allowed = ['firstTimeRun', 'theme', 'darkPalette', 'lightPalette', 'routeColumns', 'routeChecks', 'routeCheckExcludes'];
        const updates = {};
        for (const key of allowed) {
            if (key in req.body) updates[key] = req.body[key];
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No valid settings provided' });
        }
        if ('routeChecks' in updates) updates.routeChecks = updates.routeChecks === true;
        if ('routeCheckExcludes' in updates) updates.routeCheckExcludes = sanitizeHostList(updates.routeCheckExcludes);
        const wasChecking = getSettings().routeChecks;
        const settings = await saveSettings(updates);
        if (settings.routeChecks && !wasChecking) runRouteChecks();
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;

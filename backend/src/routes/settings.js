import { Router } from 'express';
import { getSettings, saveSettings } from '../settings.js';

const router = Router();

router.get('/', (req, res) => {
    res.json(getSettings());
});

router.put('/', async (req, res) => {
    try {
        const allowed = ['firstTimeRun', 'theme', 'darkPalette', 'lightPalette', 'routeColumns'];
        const updates = {};
        for (const key of allowed) {
            if (key in req.body) updates[key] = req.body[key];
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No valid settings provided' });
        }
        const settings = await saveSettings(updates);
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;

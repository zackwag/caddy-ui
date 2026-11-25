import { Router } from 'express';
import { listEvents } from '../adminEvents.js';

const router = Router();

router.get('/', async (req, res) => {
    const instanceId = req.query.instanceId || undefined;
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 200);
    res.json(await listEvents({ instanceId, limit }));
});

export default router;

import { Router } from 'express';
import { listAuditEvents } from '../auditLog.js';
import { getAuthentication } from '../middleware/auth.js';

const router = Router();

// GET /api/audit -- administrative actions across every instance, newest first
router.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ events: listAuditEvents(actor => getAuthentication().resolveActor(actor)) });
});

export default router;

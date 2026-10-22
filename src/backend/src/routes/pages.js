import { Router } from 'express';
import { getMaintenancePage } from '../maintenance.js';

const router = Router();

router.all('/maintenance', async (req, res) => {
    try {
        const html = await getMaintenancePage();
        res.status(503).type('html').send(html);
    } catch {
        res.status(503).type('html').send('<html><body><h1>Maintenance</h1></body></html>');
    }
});

export default router;

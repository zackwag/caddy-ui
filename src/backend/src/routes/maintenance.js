import { Router } from 'express';
import { AppError } from '../AppError.js';
import { changeResultFields, readSiteEnv, saveCaddyfileChange } from '../caddyfileChange.js';
import { extractSiteBlock, replaceSiteBlock } from '../caddyfileSites.js';
import { getBackendUrl } from '../dockerDiscovery.js';
import logger from '../logger.js';
import {
    buildMaintenanceBlock, clearMaintenance, getMaintenanceState, isInMaintenance, isMaintenanceBlock, setMaintenance,
} from '../maintenance.js';

const router = Router();

// GET /api/routes/maintenance -- maintenance state for the selected instance's domains
router.get('/maintenance', async (req, res) => {
    res.json(getMaintenanceState(req.instance.id));
});

// POST /api/routes/caddyfile/:domain/maintenance -- enable maintenance mode
router.post('/caddyfile/:domain/maintenance', async (req, res) => {
    const { domain } = req.params;
    let block;
    const result = await saveCaddyfileChange(req.instance, async previous => {
        if (isInMaintenance(req.instance.id, domain)) throw new AppError('CONFLICT');
        const env = await readSiteEnv(req.instance);
        block = extractSiteBlock(previous, domain, env);
        if (!block) throw new AppError('NOT_FOUND');
        if (isMaintenanceBlock(block)) throw new AppError('CONFLICT');
        const backendUrl = await getBackendUrl();
        if (!backendUrl) throw new AppError('BACKEND_URL_UNKNOWN');
        return replaceSiteBlock(previous, domain, buildMaintenanceBlock(block, backendUrl), env);
    }, { actor: req.actor, action: 'maintenance.enable', onApplied: () => setMaintenance(req.instance.id, domain, block) });

    logger.info('Maintenance mode enabled', { domain });
    res.json({ ok: true, domain, ...changeResultFields(result) });
});

// DELETE /api/routes/caddyfile/:domain/maintenance -- disable maintenance mode
router.delete('/caddyfile/:domain/maintenance', async (req, res) => {
    const { domain } = req.params;
    const result = await saveCaddyfileChange(req.instance, async previous => {
        if (!isInMaintenance(req.instance.id, domain)) throw new AppError('NOT_FOUND');
        const env = await readSiteEnv(req.instance);
        const { originalContent } = getMaintenanceState(req.instance.id)[domain];
        return replaceSiteBlock(previous, domain, originalContent, env);
    }, { actor: req.actor, action: 'maintenance.disable', onApplied: () => clearMaintenance(req.instance.id, domain) });

    logger.info('Maintenance mode disabled', { domain });
    res.json({ ok: true, domain, ...changeResultFields(result) });
});

export default router;

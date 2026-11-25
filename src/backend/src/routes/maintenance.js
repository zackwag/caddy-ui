import { Router } from 'express';
import { AppError } from '../AppError.js';
import { changeResultFields, saveCaddyfileChange } from '../caddyfileChange.js';
import { extractSiteBlock, replaceSiteBlock } from '../caddyfileSites.js';
import { readContainerFile } from '../containerFs.js';
import { getCaddyEnv } from '../docker.js';
import { getBackendUrl } from '../dockerDiscovery.js';
import { getInstances, validatedInstance } from '../instances.js';
import logger from '../logger.js';
import {
    buildMaintenanceBlock, claimUnassignedMaintenance, clearMaintenance, getMaintenanceState,
    hasUnassignedMaintenance, isInMaintenance, isMaintenanceBlock, setMaintenance,
} from '../maintenance.js';

const router = Router();

// Whether the instance's Caddyfile currently serves the maintenance page for
// the domain; null when the file can't be read. This is the only evidence used
// to assign saved state whose owner isn't recorded.
async function servesMaintenance(instance, domain) {
    try {
        const { containerName, configPath } = validatedInstance(instance);
        const [caddyfile, env] = await Promise.all([
            readContainerFile(containerName, configPath),
            getCaddyEnv(containerName),
        ]);
        return isMaintenanceBlock(extractSiteBlock(caddyfile, domain, env));
    } catch {
        return null;
    }
}

async function claimSavedMaintenance() {
    if (hasUnassignedMaintenance()) await claimUnassignedMaintenance(getInstances(), servesMaintenance);
}

// GET /api/routes/maintenance -- maintenance state for the selected instance's domains
router.get('/maintenance', async (req, res) => {
    await claimSavedMaintenance();
    res.json(getMaintenanceState(req.instance.id));
});

// POST /api/routes/caddyfile/:domain/maintenance -- enable maintenance mode
router.post('/caddyfile/:domain/maintenance', async (req, res) => {
    const { domain } = req.params;
    await claimSavedMaintenance();
    let block;
    const result = await saveCaddyfileChange(req.instance, async previous => {
        if (isInMaintenance(req.instance.id, domain)) throw new AppError('CONFLICT');
        const env = await getCaddyEnv(req.instance.containerName);
        block = extractSiteBlock(previous, domain, env);
        if (!block) throw new AppError('NOT_FOUND');
        if (isMaintenanceBlock(block)) throw new AppError('CONFLICT');
        const backendUrl = getBackendUrl();
        if (!backendUrl) throw new AppError('BACKEND_URL_UNKNOWN');
        return replaceSiteBlock(previous, domain, buildMaintenanceBlock(block, backendUrl), env);
    }, { actor: req.actor, action: 'maintenance.enable', onApplied: () => setMaintenance(req.instance.id, domain, block) });

    logger.info('Maintenance mode enabled', { domain });
    res.json({ ok: true, domain, ...changeResultFields(result) });
});

// DELETE /api/routes/caddyfile/:domain/maintenance -- disable maintenance mode
router.delete('/caddyfile/:domain/maintenance', async (req, res) => {
    const { domain } = req.params;
    await claimSavedMaintenance();
    const result = await saveCaddyfileChange(req.instance, async previous => {
        if (!isInMaintenance(req.instance.id, domain)) throw new AppError('NOT_FOUND');
        const env = await getCaddyEnv(req.instance.containerName);
        const { originalContent } = getMaintenanceState(req.instance.id)[domain];
        return replaceSiteBlock(previous, domain, originalContent, env);
    }, { actor: req.actor, action: 'maintenance.disable', onApplied: () => clearMaintenance(req.instance.id, domain) });

    logger.info('Maintenance mode disabled', { domain });
    res.json({ ok: true, domain, ...changeResultFields(result) });
});

export default router;

import { Router } from 'express';
import { caddyGet, isCaddyOnline } from '../caddy.js';
import { discoverCaddyContainers } from '../dockerDiscovery.js';
import { audited } from '../auditLog.js';
import { addInstance, generateId, getInstances, removeInstance, serverIdsFromConfig, updateInstance } from '../instances.js';
import { AppError, asAppError } from '../AppError.js';
import { validateUrl } from '../validation.js';

const router = Router();

// GET /api/instances
router.get('/', (req, res) => {
    res.json(getInstances());
});

// GET /api/instances/status -- online/offline for each instance
router.get('/status', async (req, res) => {
    res.json(await Promise.all(getInstances().map(async ({ id, adminUrl }) => ({ id, online: await isCaddyOnline(adminUrl) }))));
});

// GET /api/instances/discover -- find Caddy containers via Docker
router.get('/discover', async (req, res) => {
    let containers;
    try {
        containers = await discoverCaddyContainers();
    } catch (err) {
        throw asAppError(err, 'INSTANCE_DISCOVERY_FAILED');
    }
    const registered = new Set(getInstances().map(i => i.containerName));
    res.json(containers.filter(c => !registered.has(c.containerName)));
});

// GET /api/instances/servers?adminUrl=... -- live HTTP server IDs, so the
// instance form can offer the real IDs (e.g. srv0) instead of free text
router.get('/servers', async (req, res) => {
    let adminUrl;
    try {
        adminUrl = validateUrl(req.query.adminUrl);
    } catch (cause) {
        throw new AppError('VALIDATION_FAILED', { cause, context: { field: 'adminUrl' } });
    }
    try {
        const servers = await caddyGet('/config/apps/http/servers', adminUrl);
        res.json(serverIdsFromConfig(servers));
    } catch (err) {
        throw asAppError(err, 'INSTANCE_CONNECTION_FAILED');
    }
});

// POST /api/instances
router.post('/', async (req, res) => {
    const { name, adminUrl, configPath, logPath, dataPath, containerName, serverName } = req.body;
    if (!name || typeof name !== 'string') {
        throw new AppError('VALIDATION_FAILED', { context: { field: 'name' } });
    }
    const id = generateId(name);
    let instance;
    try {
        instance = await audited(req, { action: 'instance.add', instanceId: id, instanceName: name }, () => addInstance({
            id,
            name,
            adminUrl,
            configPath: configPath || undefined,
            logPath: logPath || undefined,
            dataPath: dataPath || undefined,
            containerName,
            serverName,
        }));
    } catch (err) {
        throw asAppError(err, 'INSTANCE_SAVE_FAILED');
    }
    res.status(201).json(instance);
});

// PUT /api/instances/:id
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, adminUrl, configPath, logPath, dataPath, containerName, serverName } = req.body;
    const raw = Object.fromEntries(
        Object.entries({ name, adminUrl, configPath, logPath, dataPath, containerName, serverName })
            .filter(([, v]) => v !== undefined)
    );
    let instance;
    try {
        instance = await audited(req, { action: 'instance.edit', instanceId: id, details: { fields: Object.keys(raw) } }, () => updateInstance(id, raw));
    } catch (err) {
        throw asAppError(err, 'INSTANCE_SAVE_FAILED', { instanceId: id });
    }
    res.json(instance);
});

// DELETE /api/instances/:id
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const instanceName = getInstances().find(instance => instance.id === id)?.name;
    try {
        await audited(req, { action: 'instance.remove', instanceId: id, instanceName }, () => removeInstance(id));
    } catch (err) {
        throw asAppError(err, 'INSTANCE_REMOVE_FAILED', { instanceId: id });
    }
    res.json({ ok: true });
});

export default router;

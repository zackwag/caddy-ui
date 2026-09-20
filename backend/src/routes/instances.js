import { Router } from 'express';
import { addInstance, getInstances, removeInstance, updateInstance } from '../instances.js';
import logger from '../logger.js';

const router = Router();

function generateId(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `instance-${Date.now()}`;
}

function validateAdminUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid admin URL: ${url}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Admin URL must use http or https');
    }
    return parsed.href;
}

// GET /api/instances
router.get('/', (req, res) => {
    res.json(getInstances());
});

// GET /api/instances/status -- online/offline for each instance
router.get('/status', async (req, res) => {
    const instances = getInstances();
    const results = await Promise.all(instances.map(async (inst) => {
        try {
            const r = await fetch(`${inst.adminUrl}/config/`, {
                headers: { 'Origin': 'http://0.0.0.0:2019' },
                signal: AbortSignal.timeout(3000),
            });
            return { id: inst.id, online: r.ok };
        } catch {
            return { id: inst.id, online: false };
        }
    }));
    res.json(results);
});

// POST /api/instances
router.post('/', async (req, res) => {
    const { name, adminUrl, configPath, logPath, dataPath, containerName, serverName } = req.body;
    if (!name || !adminUrl) {
        return res.status(400).json({ error: 'name and adminUrl are required' });
    }
    let validatedUrl;
    try {
        validatedUrl = validateAdminUrl(adminUrl);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const id = generateId(name);
    try {
        const instance = await addInstance({
            id,
            name,
            adminUrl: validatedUrl,
            configPath: configPath || '/etc/caddy/Caddyfile',
            logPath: logPath || '/var/log/caddy/access.log',
            dataPath: dataPath || '/data/caddy/caddy',
            containerName: containerName || 'caddy',
            serverName: serverName || 'srv0',
        });
        res.status(201).json(instance);
    } catch (err) {
        logger.error('Failed to add instance', { error: err.message });
        res.status(409).json({ error: err.message });
    }
});

// PUT /api/instances/:id
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, adminUrl, configPath, logPath, dataPath, containerName, serverName } = req.body;
    if (adminUrl) {
        try {
            validateAdminUrl(adminUrl);
        } catch (err) {
            return res.status(400).json({ error: err.message });
        }
    }
    try {
        const instance = await updateInstance(id, { name, adminUrl, configPath, logPath, dataPath, containerName, serverName });
        res.json(instance);
    } catch (err) {
        logger.error('Failed to update instance', { id, error: err.message });
        res.status(404).json({ error: err.message });
    }
});

// DELETE /api/instances/:id
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await removeInstance(id);
        res.json({ ok: true });
    } catch (err) {
        logger.error('Failed to remove instance', { id, error: err.message });
        res.status(400).json({ error: err.message });
    }
});

export default router;

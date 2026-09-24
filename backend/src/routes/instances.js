import { Router } from 'express';
import { discoverCaddyContainers } from '../dockerDiscovery.js';
import { addInstance, getInstances, removeInstance, updateInstance } from '../instances.js';
import logger from '../logger.js';
import { validatePath, validateUrl } from '../validation.js';

const router = Router();

function generateId(name, existingIds) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'instance';
    if (!existingIds.has(base)) return base;
    let suffix = 2;
    while (existingIds.has(`${base}-${suffix}`)) suffix++;
    return `${base}-${suffix}`;
}

function validateInstanceFields(fields) {
    const errors = [];
    if (fields.adminUrl !== undefined) {
        try { fields.adminUrl = validateUrl(fields.adminUrl); } catch (e) { errors.push(e.message); }
    }
    for (const key of ['configPath', 'logPath', 'dataPath']) {
        if (fields[key] !== undefined) {
            try { fields[key] = validatePath(fields[key]); } catch (e) { errors.push(`${key}: ${e.message}`); }
        }
    }
    if (errors.length) throw new Error(errors.join('; '));
    return fields;
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
            const url = validateUrl(inst.adminUrl);
            const r = await fetch(`${url}/config/`, {
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

// GET /api/instances/discover -- find Caddy containers via Docker
router.get('/discover', async (req, res) => {
    try {
        const containers = await discoverCaddyContainers();
        const registered = new Set(getInstances().map(i => i.containerName));
        const unregistered = containers.filter(c => !registered.has(c.containerName));
        res.json(unregistered);
    } catch (err) {
        logger.error('Docker discovery failed', { error: err.message });
        res.status(500).json({ error: 'Docker discovery failed' });
    }
});

// POST /api/instances
router.post('/', async (req, res) => {
    const { name, adminUrl, configPath, logPath, dataPath, containerName, serverName } = req.body;
    if (!name || !adminUrl) {
        return res.status(400).json({ error: 'name and adminUrl are required' });
    }
    let fields;
    try {
        fields = validateInstanceFields({
            adminUrl,
            configPath: configPath || '/etc/caddy/Caddyfile',
            logPath: logPath || '/var/log/caddy/access.log',
            dataPath: dataPath || '/data/caddy',
        });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const existingIds = new Set(getInstances().map(i => i.id));
    const id = generateId(name, existingIds);
    try {
        const instance = await addInstance({
            id,
            name,
            ...fields,
            containerName: containerName != null ? containerName : 'caddy',
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
    const raw = Object.fromEntries(
        Object.entries({ name, adminUrl, configPath, logPath, dataPath, containerName, serverName })
            .filter(([, v]) => v !== undefined)
    );
    try {
        validateInstanceFields(raw);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    try {
        const instance = await updateInstance(id, raw);
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

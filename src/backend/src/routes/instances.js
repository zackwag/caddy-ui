import { Router } from 'express';
import { caddyGet, isCaddyOnline } from '../caddy.js';
import { discoverCaddyContainers } from '../dockerDiscovery.js';
import { audited } from '../auditLog.js';
import { INSTANCE_DEFAULTS, addInstance, getInstances, removeInstance, updateInstance } from '../instances.js';
import { asAppError } from '../AppError.js';
import { validatePath, validateUrl } from '../validation.js';

const router = Router();

function generateId(name, existingIds) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'instance';
    if (!existingIds.has(base)) return base;
    let suffix = 2;
    while (existingIds.has(`${base}-${suffix}`)) suffix++;
    return `${base}-${suffix}`;
}

// Server IDs from Caddy's /config/apps/http/servers response, which is null
// when no http app is configured.
function serverIdsFromConfig(servers) {
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
    return Object.keys(servers).sort();
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
    } catch (err) {
        return res.status(400).json({ error: err.message });
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
    if (!name || !adminUrl) {
        return res.status(400).json({ error: 'name and adminUrl are required' });
    }
    let fields;
    try {
        fields = validateInstanceFields({
            adminUrl,
            configPath: configPath || INSTANCE_DEFAULTS.configPath,
            logPath: logPath || INSTANCE_DEFAULTS.logPath,
            dataPath: dataPath || INSTANCE_DEFAULTS.dataPath,
        });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const existingIds = new Set(getInstances().map(i => i.id));
    const id = generateId(name, existingIds);
    let instance;
    try {
        instance = await audited(req, { action: 'instance.add', instanceId: id, instanceName: name }, () => addInstance({
            id,
            name,
            ...fields,
            containerName: containerName ?? INSTANCE_DEFAULTS.containerName,
            serverName: serverName || INSTANCE_DEFAULTS.serverName,
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
    try {
        validateInstanceFields(raw);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
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

export { serverIdsFromConfig };
export default router;

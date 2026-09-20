import { getInstances } from '../instances.js';

function validateUrl(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('URL must use http or https');
    }
    return parsed.href;
}

function validatePath(p) {
    if (typeof p !== 'string' || p.includes('..') || p.includes('\0')) {
        throw new Error('Invalid path');
    }
    return p;
}

export function instanceMiddleware(req, res, next) {
    const instanceId = req.headers['x-instance-id'] || 'default';
    const instances = getInstances();
    const instance = instances.find(i => i.id === instanceId) || instances[0];

    try {
        req.instance = {
            id: instance.id,
            name: instance.name,
            adminUrl: validateUrl(instance.adminUrl),
            configPath: validatePath(instance.configPath),
            logPath: validatePath(instance.logPath),
            dataPath: validatePath(instance.dataPath),
            containerName: String(instance.containerName).replace(/[^a-zA-Z0-9._-]/g, ''),
            serverName: String(instance.serverName).replace(/[^a-zA-Z0-9._-]/g, ''),
        };
    } catch {
        return res.status(400).json({ error: 'Invalid instance configuration' });
    }

    next();
}

import { getInstance, getInstances } from '../instances.js';
import { validateContainerName, validatePath, validateServerName, validateUrl } from '../validation.js';

export function instanceMiddleware(req, res, next) {
    if (getInstances().length === 0) {
        return res.status(503).json({ error: 'No instances configured', code: 'NO_INSTANCES' });
    }

    // Token selection is exact: never fall back if an allowed instance disappears.
    const instance = req.apiToken
        ? getInstances().find(instance => instance.id === req.apiToken.instanceId)
        : getInstance(req.headers['x-instance-id']);
    if (!instance) {
        return res.status(404).json({ error: 'Selected instance not found', code: 'INSTANCE_SELECTION_INVALID' });
    }

    try {
        req.instance = {
            id: instance.id,
            name: instance.name,
            adminUrl: validateUrl(instance.adminUrl),
            configPath: validatePath(instance.configPath),
            logPath: validatePath(instance.logPath),
            dataPath: validatePath(instance.dataPath),
            containerName: validateContainerName(instance.containerName),
            serverName: validateServerName(instance.serverName),
        };
    } catch {
        return res.status(400).json({ error: 'Invalid instance configuration' });
    }

    next();
}

import { DEFAULT_INSTANCE_ID, getInstance, getInstances } from '../instances.js';
import { validateContainerName, validatePath, validateServerName, validateUrl } from '../validation.js';

export function instanceMiddleware(req, res, next) {
    if (getInstances().length === 0) {
        return res.status(503).json({ error: 'No instances configured', code: 'NO_INSTANCES' });
    }

    const instanceId = req.headers['x-instance-id'] || DEFAULT_INSTANCE_ID;
    const instance = getInstance(instanceId);

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

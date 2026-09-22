import { getInstances } from '../instances.js';
import { validateContainerName, validatePath, validateServerName, validateUrl } from '../validation.js';

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
            containerName: validateContainerName(instance.containerName),
            serverName: validateServerName(instance.serverName),
        };
    } catch {
        return res.status(400).json({ error: 'Invalid instance configuration' });
    }

    next();
}

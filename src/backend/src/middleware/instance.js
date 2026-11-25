import { getInstance, getInstances, validatedInstance } from '../instances.js';

// The requested instance: the X-Instance-Id header, or ?instance= for requests
// a browser makes without headers (event streams and downloads).
function requestedInstance(req) {
    const { instance } = req.query;
    return req.headers['x-instance-id'] || (typeof instance === 'string' ? instance : undefined);
}

export function instanceMiddleware(req, res, next) {
    if (getInstances().length === 0) {
        return res.status(503).json({ error: 'No instances configured', code: 'NO_INSTANCES' });
    }

    // Token selection is exact: never fall back if an allowed instance disappears.
    const instance = req.apiToken
        ? getInstances().find(instance => instance.id === req.apiToken.instanceId)
        : getInstance(requestedInstance(req));
    if (!instance) {
        return res.status(404).json({ error: 'Selected instance not found', code: 'INSTANCE_SELECTION_INVALID' });
    }

    try {
        req.instance = validatedInstance(instance);
    } catch {
        return res.status(400).json({ error: 'Invalid instance configuration' });
    }

    next();
}

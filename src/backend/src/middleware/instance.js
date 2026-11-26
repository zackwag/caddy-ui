import { AppError } from '../AppError.js';
import { getInstance, getInstances } from '../instances.js';

// The requested instance: the X-Instance-Id header, or ?instance= for requests
// a browser makes without headers (event streams and downloads).
function requestedInstance(req) {
    const { instance } = req.query;
    return req.headers['x-instance-id'] || (typeof instance === 'string' ? instance : undefined);
}

export function instanceMiddleware(req, res, next) {
    if (getInstances().length === 0) {
        throw new AppError('NO_INSTANCES');
    }

    // Token selection is exact: never fall back if an allowed instance disappears.
    const instance = req.apiToken
        ? getInstances().find(instance => instance.id === req.apiToken.instanceId)
        : getInstance(requestedInstance(req));
    if (!instance) {
        throw new AppError('INSTANCE_SELECTION_INVALID');
    }

    req.instance = instance;
    next();
}

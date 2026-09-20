import { getInstance } from '../instances.js';

export function instanceMiddleware(req, res, next) {
    const instanceId = req.headers['x-instance-id'] || 'default';
    req.instance = getInstance(instanceId);
    next();
}

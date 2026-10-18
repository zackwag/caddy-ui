import { AppError } from '../AppError.js';
import { apiTokenScope } from '../apiTokenPolicy.js';
import { DEFAULT_INSTANCE_ID, getInstances } from '../instances.js';
import { sendAppError } from '../errorReporting.js';

export function createApiTokenMiddleware(service) {
    return (req, res, next) => {
        if (req.headers.authorization === undefined) return next();
        // Proxies may forward another scheme (for example HTTP Basic). It grants
        // no API privilege here; the normal cookie/session checks still apply.
        if (typeof req.headers.authorization === 'string' && !/^Bearer(?:\s|$)/i.test(req.headers.authorization)) return next();
        try {
            // A supplied Bearer header constrains the request even when a
            // valid administrator cookie is also present. No credential fallback.
            const count = (req.rawHeaders || []).filter((value, i) => i % 2 === 0 && value.toLowerCase() === 'authorization').length;
            const match = typeof req.headers.authorization === 'string' && /^Bearer (cui_[A-Za-z0-9_-]{43})$/i.exec(req.headers.authorization);
            const token = count > 1 || !match ? null : service.verifyApiToken(match[1]);
            if (!token) throw new AppError('UNAUTHORIZED');
            const scope = apiTokenScope(req.method, req.path);
            if (!scope || !token.scopes.includes(scope)) throw new AppError('FORBIDDEN');
            const instanceId = req.headers['x-instance-id'] || DEFAULT_INSTANCE_ID;
            if (!token.instanceIds.includes(instanceId)) throw new AppError('FORBIDDEN');
            if (!getInstances().some(instance => instance.id === instanceId)) throw new AppError('INSTANCE_SELECTION_INVALID');
            req.apiToken = { ...token, instanceId };
            res.set('Cache-Control', 'no-store');
            return next();
        } catch (error) { return sendAppError(res, error); }
    };
}

import { randomUUID } from 'node:crypto';
import logger from './logger.js';
import { AppError, errorChain, publicError } from './AppError.js';
import { ERROR_REGISTRY, errorDefinition } from './errorRegistry.js';

export function errorCode(path, status) {
    if (status === 429) return 'RATE_LIMITED';
    if (status === 401) return 'UNAUTHORIZED';
    if (status === 403) return 'FORBIDDEN';
    if (path.startsWith('/api/caddyfile') && status === 422) return 'CADDYFILE_VALIDATION_FAILED';
    if (status === 400 || status === 422) return 'VALIDATION_FAILED';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'CONFLICT';
    if (status === 502 || status === 503 || status === 504) return 'UPSTREAM_UNAVAILABLE';
    if (path.startsWith('/api/metrics') || path === '/api/status/process') return 'METRICS_UNAVAILABLE';
    if (path.startsWith('/api/status')) return 'CADDY_STATUS_UNAVAILABLE';
    return 'REQUEST_FAILED';
}

export function sendAppError(res, error) {
    if (!(error instanceof AppError)) throw new TypeError('sendAppError expects AppError');
    const definition = errorDefinition(error.code);
    res.locals ??= {};
    res.locals.appError = error;
    return res.status(definition.status).json(publicError(error));
}

function details(body) {
    if (!body || typeof body !== 'object') return null;
    return body.error || body.errors || body.warning || body.warnings || null;
}

// Express middleware: decorate failures at their source so the UI gets a stable
// code and request ID even when a route catches an exception internally.
export function diagnosticMiddleware(req, res, next) {
    const requestId = randomUUID();
    // Mounted routers temporarily strip their prefix from req.path. Capture the
    // original path once, without query parameters, before routing begins.
    const path = (req.originalUrl || req.path).split('?')[0];
    req.diagnosticId = requestId;
    req.diagnosticPath = path;
    res.setHeader('X-Request-ID', requestId);
    const originalJson = res.json.bind(res);
    res.json = function diagnosticJson(body) {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return originalJson(body);
        // A few endpoints intentionally return HTTP 200 with ok:false / online:false.
        const softFailure = (body.ok === false && Boolean(body.error))
            || (path.replace(/\/$/, '') === '/api/status' && body.online === false && Boolean(body.error));
        const failed = res.statusCode >= 400 || softFailure;
        const hasWarning = !failed && Boolean(body.warning || (Array.isArray(body.warnings) && body.warnings.length));
        if (!failed && !hasWarning) return originalJson(body);
        const code = body.code || body.warningCode || errorCode(path, res.statusCode);
        const detail = details(body);
        const appError = res.locals?.appError;
        const log = {
            requestId, code, method: req.method, path,
            status: res.statusCode, detail,
            ...(appError ? { causes: errorChain(appError) } : {}),
        };
        if (failed) {
            const level = appError ? errorDefinition(appError.code).level
                : Object.hasOwn(ERROR_REGISTRY, code) ? errorDefinition(code).level
                : res.statusCode >= 500 || softFailure ? 'error' : 'warn';
            logger[level]('API request failed', log);
        }
        else logger.warn('API returned a warning', log);
        return originalJson({
            ...body,
            ...(failed ? { code } : { warningCode: code }),
            requestId,
        });
    };
    next();
}

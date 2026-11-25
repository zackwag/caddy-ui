import { randomUUID } from 'node:crypto';
import logger from './logger.js';
import { AppError, errorChain, publicError } from './AppError.js';
import { ERROR_REGISTRY, errorDefinition } from './errorRegistry.js';

// The code for a failure whose handler didn't name one.
function codeForStatus(status) {
    if (status === 429) return 'RATE_LIMITED';
    if (status === 401) return 'UNAUTHORIZED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 400 || status === 422) return 'VALIDATION_FAILED';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'CONFLICT';
    if (status === 502 || status === 503 || status === 504) return 'UPSTREAM_UNAVAILABLE';
    return 'REQUEST_FAILED';
}

// Attaches the failure behind a response, so it's logged with its causes and
// counts as a failure whatever the HTTP status.
function attachError(res, error) {
    if (!(error instanceof AppError)) throw new TypeError('Expected an AppError');
    res.locals ??= {};
    res.locals.appError = error;
}

export function sendAppError(res, error) {
    attachError(res, error);
    return res.status(error.status).json(publicError(error));
}

// A failure with response fields of its own. `status` defaults to the error's;
// a few endpoints report a failure in a 200 response.
export function sendFailure(res, error, body, status = error.status) {
    attachError(res, error);
    return res.status(status).json({ code: error.code, ...body });
}

// Last in the app: what a route throws becomes its response, so routes only
// catch errors they translate. An AppError carries its own status and code.
export function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    if (err instanceof AppError) return sendAppError(res, err);
    logger.error('Unhandled error', { requestId: req.diagnosticId, method: req.method, path: req.diagnosticPath || req.path, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message || 'Internal server error' });
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
        const appError = res.locals?.appError;
        const failed = res.statusCode >= 400 || Boolean(appError);
        const hasWarning = !failed && Boolean(body.warning || (Array.isArray(body.warnings) && body.warnings.length));
        if (!failed && !hasWarning) return originalJson(body);
        const code = body.code || body.warningCode || codeForStatus(res.statusCode);
        const detail = details(body);
        const log = {
            requestId, code, method: req.method, path,
            status: res.statusCode, detail,
            ...(appError ? { causes: errorChain(appError) } : {}),
        };
        if (failed) {
            const level = appError ? errorDefinition(appError.code).level
                : Object.hasOwn(ERROR_REGISTRY, code) ? errorDefinition(code).level
                : res.statusCode >= 500 ? 'error' : 'warn';
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

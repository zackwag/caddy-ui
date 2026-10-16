import { AppError } from '../AppError.js';
import { sendAppError } from '../errorReporting.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Browsers label every request with Sec-Fetch-Site, and pages can't override it.
// The UI always calls the API from its own origin, so a write from another site is
// forged. Without CORS headers such pages can't read responses, but a bodiless or
// text/plain POST is still sent without a preflight. Clients that aren't browsers
// don't send the header and are unaffected.
export function isCrossSiteWrite(method, headers) {
    if (SAFE_METHODS.has(method)) return false;
    const site = headers['sec-fetch-site'];
    return site === 'cross-site' || site === 'same-site';
}

export function crossSiteMiddleware(req, res, next) {
    if (!isCrossSiteWrite(req.method, req.headers)) return next();
    sendAppError(res, new AppError('FORBIDDEN', {
        message: 'Rejected cross-site request',
        context: { origin: req.headers.origin || null, site: req.headers['sec-fetch-site'] },
    }));
}

import { AppError } from '../AppError.js';
import { sendAppError } from '../errorReporting.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Fetch Metadata is absent on some plain HTTP destinations. Origin takes
// precedence over Referer, including an opaque "null" origin. Never infer the
// expected origin from Host or forwarded headers: proxies can change both.
export function isCrossSiteWrite(method, headers, expectedOrigin) {
    if (SAFE_METHODS.has(method)) return false;
    const site = headers['sec-fetch-site'];
    if (site === 'cross-site' || site === 'same-site') return true;

    const origin = headers.origin;
    const referer = headers.referer;
    if (origin === 'null') return true;
    const hasBrowserOrigin = origin !== undefined || referer !== undefined;
    if (!expectedOrigin) {
        // Preserve trustworthy same-origin browser requests and headerless
        // scripts. Other browser-origin writes require explicit configuration.
        return hasBrowserOrigin && site !== 'same-origin';
    }
    if (origin !== undefined) return origin !== expectedOrigin;
    if (referer !== undefined) {
        if (typeof referer !== 'string') return true;
        try {
            return new URL(referer).origin !== expectedOrigin;
        } catch {
            return true;
        }
    }
    // Requests without any origin evidence remain compatible with scripts.
    // This is not authentication or a complete replacement for CSRF tokens.
    return false;
}

export function createCrossSiteMiddleware(publicUrl) {
    let expectedOrigin;
    if (publicUrl !== undefined && publicUrl !== '') {
        let configured;
        try {
            configured = new URL(publicUrl);
        } catch {
            throw new TypeError('CADDY_UI_EXTERNAL_URL must be an HTTP(S) URL without credentials');
        }
        if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password) {
            throw new TypeError('CADDY_UI_EXTERNAL_URL must be an HTTP(S) URL without credentials');
        }
        expectedOrigin = configured.origin;
    }

    return (req, res, next) => {
        if (!isCrossSiteWrite(req.method, req.headers, expectedOrigin)) return next();
        return sendAppError(res, new AppError('FORBIDDEN', {
            message: expectedOrigin ? 'Rejected cross-site request'
                : 'Browser-origin writes without same-origin Fetch Metadata require CADDY_UI_EXTERNAL_URL',
            context: {
                origin: req.headers.origin ?? null,
                site: req.headers['sec-fetch-site'] ?? null,
                expectedOrigin: expectedOrigin ?? null,
            },
        }));
    };
}

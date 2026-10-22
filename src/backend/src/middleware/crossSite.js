import { AppError } from '../AppError.js';
import { sendAppError } from '../errorReporting.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Fetch Metadata is absent on some plain HTTP destinations. Origin takes
// precedence over Referer, including an opaque "null" origin. Never infer the
// expected origin from Host or forwarded headers: proxies can change both.
// expectedOrigins: null (unconfigured) or a Set of allowed origin strings.
export function isCrossSiteWrite(method, headers, expectedOrigins) {
    if (SAFE_METHODS.has(method)) return false;
    const site = headers['sec-fetch-site'];
    if (site === 'cross-site' || site === 'same-site') return true;

    const origin = headers.origin;
    const referer = headers.referer;
    if (origin === 'null') return true;
    const hasBrowserOrigin = origin !== undefined || referer !== undefined;
    if (!expectedOrigins) {
        // Preserve trustworthy same-origin browser requests and headerless
        // scripts. Other browser-origin writes require explicit configuration.
        return hasBrowserOrigin && site !== 'same-origin';
    }
    if (origin !== undefined) return !expectedOrigins.has(origin);
    if (referer !== undefined) {
        if (typeof referer !== 'string') return true;
        try {
            return !expectedOrigins.has(new URL(referer).origin);
        } catch {
            return true;
        }
    }
    // Requests without any origin evidence remain compatible with scripts.
    // This is not authentication or a complete replacement for CSRF tokens.
    return false;
}

export function createCrossSiteMiddleware(publicUrl) {
    const expectedOrigins = new Set();
    if (publicUrl !== undefined && publicUrl !== '') {
        for (const entry of publicUrl.split(',')) {
            const trimmed = entry.trim();
            if (!trimmed) continue;
            let configured;
            try {
                configured = new URL(trimmed);
            } catch {
                throw new TypeError('CADDY_UI_EXTERNAL_URL must be comma-separated HTTP(S) URLs without credentials');
            }
            if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password) {
                throw new TypeError('CADDY_UI_EXTERNAL_URL must be comma-separated HTTP(S) URLs without credentials');
            }
            expectedOrigins.add(configured.origin);
        }
    }
    const hasExpected = expectedOrigins.size > 0;

    return (req, res, next) => {
        if (!isCrossSiteWrite(req.method, req.headers, hasExpected ? expectedOrigins : null)) return next();
        return sendAppError(res, new AppError('FORBIDDEN', {
            message: hasExpected ? 'Rejected cross-site request'
                : 'Browser-origin writes without same-origin Fetch Metadata require CADDY_UI_EXTERNAL_URL',
            context: {
                origin: req.headers.origin ?? null,
                site: req.headers['sec-fetch-site'] ?? null,
                expectedOrigins: hasExpected ? [...expectedOrigins] : null,
            },
        }));
    };
}

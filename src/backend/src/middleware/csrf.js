import { isSafeMethod } from './safeMethods.js';

export function createCsrfMiddleware(sessions) {
    return (req, res, next) => {
        if (isSafeMethod(req.method) || sessions.verifyCsrfToken(req)) return next();
        // No headerless exemption: every browser write needs a valid context.
        // Read-only integration tokens cannot authorize any write or bypass this.
        return res.status(403).json({ code: 'CSRF_INVALID', error: 'Refresh the session before retrying this operation' });
    };
}

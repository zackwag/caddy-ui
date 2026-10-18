const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createCsrfMiddleware(sessions) {
    return (req, res, next) => {
        if (SAFE_METHODS.has(req.method) || sessions.verifyCsrfToken(req)) return next();
        // No headerless exemption: every browser write needs a valid context.
        // Future integration tokens need their own validated authentication path.
        return res.status(403).json({ code: 'CSRF_INVALID', error: 'Refresh the session before retrying this operation' });
    };
}

import { createAuthService } from '../authService.js';
import { sendAppError } from '../errorReporting.js';

let authentication;
export const publicMetrics = process.env.CADDY_UI_PUBLIC_METRICS === 'true';

export async function initializeAuthentication(options) {
    authentication = await createAuthService(options);
    return authentication;
}

export function getAuthentication() {
    if (!authentication) throw new Error('Authentication has not been initialized');
    return authentication;
}

export function authMiddleware(req, res, next) {
    try {
        // Public metrics permits reads only, never configuration changes.
        if (!(publicMetrics && req.method === 'GET' && req.path === '/metrics')) {
            getAuthentication().requireManagement(req, res);
        }
        next();
    } catch (error) {
        if (!error.code) return next(error);
        return sendAppError(res, error);
    }
}

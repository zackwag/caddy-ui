import { createAuthService } from '../authService.js';
import { sendAppError } from '../errorReporting.js';
import logger from '../logger.js';

let authentication;
export const publicMetrics = process.env.CADDY_UI_PUBLIC_METRICS === 'true';

export async function initializeAuthentication(options) {
    authentication = await createAuthService(options);
    const state = authentication.getAuthState({ headers: {} });
    if (state.setupRequired && !state.enrollmentRequired) {
        logger.warn('Administrator enrollment is open: no stored or legacy credentials exist. The first person reaching the setup page can claim administrator access. Restrict access until enrollment is complete.');
    }
    const externalUrl = (options?.env ?? process.env).CADDY_UI_EXTERNAL_URL;
    const configuredUrls = externalUrl ? externalUrl.split(',').map(u => u.trim()).filter(Boolean) : [];
    const allHttps = configuredUrls.length > 0 && configuredUrls.every(u => { try { return new URL(u).protocol === 'https:'; } catch { return false; } });
    if (!allHttps) {
        logger.warn('Secure session cookies are not enabled. For HTTPS deployments, set CADDY_UI_EXTERNAL_URL=https://your-public-hostname to enable them. Adding any HTTP origin disables Secure cookies for all origins. TLS setup can help you with that.');
    }
    return authentication;
}

export function getAuthentication() {
    if (!authentication) throw new Error('Authentication has not been initialized');
    return authentication;
}

export function authMiddleware(req, res, next) {
    try {
        // Public metrics permits reads only, never configuration changes.
        if (!req.apiToken && !(publicMetrics && req.method === 'GET' && req.path === '/metrics')) {
            getAuthentication().requireManagement(req, res);
        }
        next();
    } catch (error) {
        if (!error.code) return next(error);
        return sendAppError(res, error);
    }
}

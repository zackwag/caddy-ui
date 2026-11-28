import { createAuthService } from '../authService.js';
import { servesOnlyHttps } from '../externalUrls.js';
import logger from '../logger.js';

let authentication;

export async function initializeAuthentication(options) {
    authentication = await createAuthService(options);
    const state = authentication.getAuthState({ headers: {} });
    if (state.setupRequired && !state.enrollmentRequired) {
        logger.warn('Administrator enrollment is open: no stored or legacy credentials exist. The first person reaching the setup page can claim administrator access. Restrict access until enrollment is complete.');
    }
    if (!servesOnlyHttps(options?.externalUrls ?? [])) {
        logger.warn('Secure session cookies are not enabled. For HTTPS deployments, set CADDY_UI_EXTERNAL_URL=https://your-public-hostname to enable them. Adding any HTTP origin disables Secure cookies for all origins. TLS setup can help you with that.');
    }
    return authentication;
}

export function getAuthentication() {
    if (!authentication) {
        throw new Error('Authentication has not been initialized');
    }
    return authentication;
}

// Requires a management session, or the API token an earlier middleware
// accepted, and attaches who is acting for history and audit records.
export function authMiddleware(req, res, next) {
    const authentication = getAuthentication();
    if (!req.apiToken) {
        authentication.requireManagement(req, res);
    }
    req.actor = authentication.getActor(req);
    next();
}

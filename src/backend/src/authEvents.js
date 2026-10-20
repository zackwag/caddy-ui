import { isIP } from 'node:net';
import logger from './logger.js';
import { notifyAuthenticationEvent } from './notifications.js';

// Only these allowlisted fields leave authentication; never pass request bodies,
// submitted usernames, challenges, credential IDs or exception details through.
export function recordAuthentication(req, method, outcome, passkeysConfigured = false) {
    const recovery = method === 'recovery';
    const fallback = method === 'password' && outcome === 'success' && passkeysConfigured;
    const severity = recovery || fallback || outcome === 'failure' ? 'warn' : 'info';
    const address = req.ip || req.socket?.remoteAddress;
    const event = { event: 'authentication', timestamp: new Date().toISOString(), method, outcome,
        sourceIp: isIP(address || '') ? address : 'unknown',
        ...(method === 'password' && outcome === 'success' ? { passkeysConfigured } : {}) };
    logger[severity]('Authentication event', event);
    const name = recovery ? 'Account recovery' : method === 'password' ? 'Password sign-in' : 'Passkey sign-in';
    const title = fallback ? 'Password sign-in while passkeys are configured'
        : `${name} ${outcome === 'success' ? 'succeeded' : 'failed'}`;
    // Both synchronous transport failures and rejected promises are detached from
    // the credential operation. A slow provider must not hold the auth queue.
    void Promise.resolve().then(() => notifyAuthenticationEvent({ ...event, title,
        priority: recovery || fallback ? 'high' : 'default' })).catch(() => {
        logger.warn('Authentication notification delivery failed', { method, outcome });
    });
}

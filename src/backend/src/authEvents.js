import { isIP } from 'node:net';
import logger from './logger.js';

const listeners = new Set();

export function onAuthenticationEvent(listener) {
    listeners.add(listener);
}

export const isPasswordMethod = method => method === 'password' || method === 'password-totp';

// Only these allowlisted fields leave authentication; never pass request bodies,
// submitted usernames, challenges, credential IDs or exception details through.
export function recordAuthentication(req, method, outcome, passkeysConfigured = false) {
    const password = isPasswordMethod(method);
    const fallback = password && outcome === 'success' && passkeysConfigured;
    const severity = method === 'recovery' || fallback || outcome === 'failure' ? 'warn' : 'info';
    const address = req.ip || req.socket?.remoteAddress;
    const event = { event: 'authentication', timestamp: new Date().toISOString(), method, outcome,
        sourceIp: isIP(address || '') ? address : 'unknown',
        ...(password && outcome === 'success' ? { passkeysConfigured } : {}) };
    logger[severity]('Authentication event', event);
    // Both synchronous failures and rejected promises are detached from the
    // credential operation. A slow provider must not hold the auth queue.
    for (const listener of listeners) {
        void Promise.resolve().then(() => listener(event)).catch(() => {
            logger.warn('Authentication notification delivery failed', { method, outcome });
        });
    }
}

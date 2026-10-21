import { Secret, TOTP } from 'otpauth';

export const TOTP_CHALLENGE_MS = 5 * 60 * 1000;
export const TOTP_ATTEMPTS = 5;
export const TOTP_COOLDOWN_MS = 5 * 60 * 1000;
export const TOTP_PERIOD_MS = 30000;

export class TotpCooldownError extends Error {
    constructor(remainingMs) {
        super('Authenticator verification is cooling down');
        this.retryAfter = Math.max(1, Math.ceil(remainingMs / 1000));
    }
}

function validFailures(value) {
    return value === undefined || (value && typeof value === 'object'
        && Number.isSafeInteger(value.count) && value.count >= 0 && value.count <= TOTP_ATTEMPTS
        && Number.isSafeInteger(value.blockedUntil) && value.blockedUntil >= 0
        && (value.count < TOTP_ATTEMPTS ? value.blockedUntil === 0 : value.blockedUntil > 0));
}

export function validTotpRecord(record) {
    return record && typeof record === 'object' && typeof record.secret === 'string'
        && record.secret.length === 32 && /^[A-Z2-7]{32}$/.test(record.secret)
        && Number.isSafeInteger(record.lastAcceptedStep) && record.lastAcceptedStep >= 0
        && typeof record.createdAt === 'string' && Number.isFinite(Date.parse(record.createdAt))
        && validFailures(record.failures);
}

function authenticator(secret, label = '') {
    return new TOTP({ issuer: 'Caddy UI', label, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) });
}

export function createTotpEnrollment(username) {
    const secret = new Secret({ size: 20 }).base32;
    return { secret, uri: authenticator(secret, username).toString() };
}

// Persist the accepted step before granting access, including a future step
// accepted within clock tolerance. This floor survives backend restarts.
export function totpStep(secret, code, timestamp, lastAcceptedStep = -1) {
    if (typeof code !== 'string' || code.length !== 6 || !/^\d{6}$/.test(code)) return null;
    const delta = authenticator(secret).validate({ token: code, timestamp, window: 1 });
    if (delta === null) return null;
    const step = Math.floor(timestamp / TOTP_PERIOD_MS) + delta;
    return step > lastAcceptedStep ? step : null;
}

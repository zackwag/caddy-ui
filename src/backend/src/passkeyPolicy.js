export const MAX_PASSKEYS = 3;
export const PASSKEY_ALGORITHMS = [-7, -257];

export class PasskeyValidationError extends Error {}

const encoded = (value, maximum) => typeof value === 'string' && value.length > 0
    && value.length <= maximum && /^[A-Za-z0-9_-]+$/.test(value)
    && Buffer.from(value, 'base64url').toString('base64url') === value;
export const validPasskeyName = value => typeof value === 'string' && !!value.trim() && value.length <= 80;

export function validPasskeyRecord(value) {
    return value && encoded(value.id, 2048) && encoded(value.publicKey, 4096)
        && validPasskeyName(value.name) && typeof value.rpId === 'string' && !!value.rpId
        && Number.isSafeInteger(value.counter) && value.counter >= 0
        && ['singleDevice', 'multiDevice'].includes(value.deviceType) && typeof value.backedUp === 'boolean'
        && Array.isArray(value.transports) && value.transports.length <= 8
        && value.transports.every(transport => typeof transport === 'string' && transport.length <= 32)
        && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
        && (value.lastUsedAt === null || (typeof value.lastUsedAt === 'string' && Number.isFinite(Date.parse(value.lastUsedAt))));
}

export function validPasskeyStore(value) {
    return value && encoded(value.userId, 43) && Buffer.from(value.userId, 'base64url').length === 32
        && Array.isArray(value.credentials) && value.credentials.length <= MAX_PASSKEYS
        && value.credentials.every(validPasskeyRecord)
        && new Set(value.credentials.map(key => key.id)).size === value.credentials.length;
}

export function passkeyMetadata({ publicKey, counter, transports, ...metadata }) {
    return structuredClone(metadata);
}

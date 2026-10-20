import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import logger from './logger.js';
import { MAX_API_TOKENS, validApiTokenInput, validApiTokenRecord } from './apiTokenPolicy.js';
import { MAX_PASSKEYS, PasskeyValidationError, validPasskeyRecord, validPasskeyStore } from './passkeyPolicy.js';

const derive = promisify(scrypt);
const KDF = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function apiTokenMetadata({ hash, ...metadata }) { return structuredClone(metadata); }

function validHash(value) {
    return value?.algorithm === 'scrypt' && /^[a-f0-9]{32}$/.test(value.salt)
        && /^[a-f0-9]{128}$/.test(value.digest);
}

async function hashSecret(secret) {
    const salt = randomBytes(16).toString('hex');
    const digest = await derive(secret, salt, 64, KDF);
    return { algorithm: 'scrypt', salt, digest: digest.toString('hex') };
}

async function matches(secret, hash) {
    if (typeof secret !== 'string' || Buffer.byteLength(secret) > 1024) return false;
    const digest = await derive(secret, hash.salt, 64, KDF);
    return timingSafeEqual(digest, Buffer.from(hash.digest, 'hex'));
}

function validateUsername(username) {
    if (typeof username !== 'string' || !username.trim() || username.length > 128) {
        throw new Error('Username must contain between 1 and 128 characters');
    }
}

export function validateCredentials(username, password) {
    validateUsername(username);
    if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 1024) {
        throw new Error('Password must contain at least 12 characters and at most 1024 bytes');
    }
}

// Authentication has its own store. UI metadata remains installation-wide.
export function createAuthStore(path = process.env.AUTH_PATH || '/etc/caddy-ui/auth.json', { now = Date.now } = {}) {
    let state;
    let writes = Promise.resolve();

    function serialize(operation) {
        const result = writes.then(operation);
        writes = result.catch(() => {});
        return result;
    }

    async function loadAuth() {
        try {
            const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            let parsed;
            try {
                parsed = JSON.parse(await handle.readFile('utf8'));
            } finally {
                await handle.close();
            }
            if (parsed?.version !== 1 || typeof parsed.username !== 'string' || !parsed.username.trim()
                || parsed.username.length > 128 || !validHash(parsed.password) || !validHash(parsed.recovery)
                || (parsed.apiTokens !== undefined && (!Array.isArray(parsed.apiTokens) || parsed.apiTokens.length > MAX_API_TOKENS
                    || !parsed.apiTokens.every(validApiTokenRecord) || new Set(parsed.apiTokens.map(token => token.id)).size !== parsed.apiTokens.length))
                || (parsed.passkeys !== undefined && !validPasskeyStore(parsed.passkeys))) {
                throw new Error('Invalid credential record');
            }
            await fs.chmod(path, 0o600);
            state = parsed;
        } catch (error) {
            if (error.code !== 'ENOENT') throw new Error('Cannot read authentication storage. Refusing to start.', { cause: error });
            state = null;
        }
        return state !== null;
    }

    async function persist(record, initialize) {
        await fs.mkdir(dirname(path), { recursive: true });
        const temporary = join(dirname(path), `.auth-${randomBytes(16).toString('hex')}.tmp`);
        let handle;
        try {
            handle = await fs.open(temporary, 'wx', 0o600);
            await handle.writeFile(JSON.stringify(record, null, 2) + '\n');
            await handle.sync();
            await handle.close();
            handle = null;
            // link() is exclusive across processes as well as concurrent requests.
            // Replacement uses rename() so readers never see a partial record.
            if (initialize) await fs.link(temporary, path);
            else await fs.rename(temporary, path);
            state = record;
        } finally {
            if (handle) await handle.close();
            await fs.unlink(temporary).catch(error => {
                if (error.code !== 'ENOENT') logger.warn('Could not remove temporary authentication file', { code: error.code });
            });
        }
    }

    function requireLoaded() {
        if (state === undefined) throw new Error('Authentication storage has not been loaded');
    }

    async function recordFor(username, password) {
        validateCredentials(username, password);
        const recoveryKey = randomBytes(32).toString('base64url');
        const record = { version: 1, username, password: await hashSecret(password), recovery: await hashSecret(recoveryKey) };
        return { record, recoveryKey };
    }

    return {
        loadAuth,
        isInitialized() { requireLoaded(); return state !== null; },
        getUsername() { requireLoaded(); return state?.username ?? null; },
        getPasskeyUserId() { requireLoaded(); return state?.passkeys?.userId ?? null; },
        listPasskeys() { requireLoaded(); return structuredClone(state?.passkeys?.credentials || []); },
        hasPasskey(rpId) { requireLoaded(); return !!state?.passkeys?.credentials.some(key => key.rpId === rpId); },
        ensurePasskeyUserId() {
            return serialize(async () => {
                requireLoaded();
                if (!state) throw new Error('Authentication is not initialized');
                if (!state.passkeys) await persist({ ...state, passkeys: { userId: randomBytes(32).toString('base64url'), credentials: [] } }, false);
                return state.passkeys.userId;
            });
        },
        addPasskey(record) {
            return serialize(async () => {
                requireLoaded();
                const previous = state?.passkeys;
                if (!previous || !validPasskeyRecord(record) || previous.credentials.length >= MAX_PASSKEYS
                    || previous.credentials.some(key => key.id === record.id)) throw new PasskeyValidationError('Invalid or duplicate passkey');
                await persist({ ...state, passkeys: { ...previous, credentials: [...previous.credentials, structuredClone(record)] } }, false);
            });
        },
        updatePasskeyUsage(id, { newCounter, credentialDeviceType, credentialBackedUp }) {
            return serialize(async () => {
                requireLoaded();
                const previous = state?.passkeys;
                const key = previous?.credentials.find(key => key.id === id);
                if (!key) throw new PasskeyValidationError('Passkey no longer exists');
                const updated = { ...key, counter: newCounter, deviceType: credentialDeviceType,
                    backedUp: credentialBackedUp, lastUsedAt: new Date(now()).toISOString() };
                if (!validPasskeyRecord(updated) || (key.counter > 0 && newCounter <= key.counter)) throw new PasskeyValidationError('Invalid passkey counter');
                await persist({ ...state, passkeys: { ...previous, credentials: previous.credentials.map(key => key.id === id ? updated : key) } }, false);
            });
        },
        removePasskey(id) {
            return serialize(async () => {
                requireLoaded();
                const previous = state?.passkeys;
                if (!previous?.credentials.some(key => key.id === id)) return false;
                await persist({ ...state, passkeys: { ...previous, credentials: previous.credentials.filter(key => key.id !== id) } }, false);
                return true;
            });
        },
        async verifyPassword(username, password) {
            requireLoaded();
            // Derive even for an unknown username to avoid a cheap username oracle.
            return state !== null && await matches(password, state.password) && username === state.username;
        },
        listApiTokens() {
            requireLoaded();
            return (state?.apiTokens || []).map(apiTokenMetadata);
        },
        verifyApiToken(token) {
            requireLoaded();
            if (typeof token !== 'string' || !/^cui_[A-Za-z0-9_-]{43}$/.test(token)) return null;
            const digest = createHash('sha256').update(token).digest();
            const record = (state?.apiTokens || []).find(record => timingSafeEqual(digest, Buffer.from(record.hash, 'hex')));
            if (!record || Date.parse(record.expiresAt) <= now()) return null;
            return apiTokenMetadata(record);
        },
        issueApiToken(input) {
            return serialize(async () => {
                requireLoaded();
                if (!state || !validApiTokenInput(input)) throw new Error('Invalid API token configuration');
                const previous = state.apiTokens || [];
                if (previous.length >= MAX_API_TOKENS) throw new Error('API token limit reached');
                const token = 'cui_' + randomBytes(32).toString('base64url');
                const time = now();
                const metadata = { id: randomBytes(16).toString('hex'), name: input.name.trim(),
                    scopes: [...input.scopes], instanceIds: [...input.instanceIds],
                    createdAt: new Date(time).toISOString(), expiresAt: new Date(time + input.expiresInDays * 86400000).toISOString() };
                await persist({ ...state, apiTokens: [...previous, { ...metadata, hash: createHash('sha256').update(token).digest('hex') }] }, false);
                return { ...structuredClone(metadata), token };
            });
        },
        revokeApiToken(id) {
            return serialize(async () => {
                requireLoaded();
                const previous = state?.apiTokens || [];
                if (!previous.some(token => token.id === id)) return false;
                await persist({ ...state, apiTokens: previous.filter(token => token.id !== id) }, false);
                return true;
            });
        },
        initializeAuth(username, password) {
            return serialize(async () => {
                requireLoaded();
                if (state !== null) throw new Error('Authentication is already initialized');
                const { record, recoveryKey } = await recordFor(username, password);
                await persist(record, true);
                return recoveryKey;
            });
        },
        updateCredentials(username, password) {
            return serialize(async () => {
                requireLoaded();
                if (!state) throw new Error('Authentication is not initialized');
                validateUsername(username);
                if (password !== undefined) validateCredentials(username, password);
                // Normal account changes preserve recovery and integration credentials.
                const record = { ...state, username,
                    password: password === undefined ? state.password : await hashSecret(password) };
                await persist(record, false);
            });
        },
        replaceCredentials(recoveryKey, password) {
            return serialize(async () => {
                requireLoaded();
                if (!state || !await matches(recoveryKey, state.recovery)) return null;
                const next = await recordFor(state.username, password);
                // Replacing the whole record deliberately revokes API tokens and passkeys.
                await persist(next.record, false);
                return next.recoveryKey;
            });
        },
    };
}

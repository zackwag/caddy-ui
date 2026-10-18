import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import logger from './logger.js';

const derive = promisify(scrypt);
const KDF = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

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

export function validateCredentials(username, password) {
    if (typeof username !== 'string' || !username.trim() || username.length > 128) {
        throw new Error('Username must contain between 1 and 128 characters');
    }
    if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 1024) {
        throw new Error('Password must contain at least 12 characters and at most 1024 bytes');
    }
}

// Authentication has its own store. UI metadata remains installation-wide.
export function createAuthStore(path = process.env.AUTH_PATH || '/etc/caddy-ui/auth.json') {
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
                || parsed.username.length > 128 || !validHash(parsed.password) || !validHash(parsed.recovery)) {
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
        async verifyPassword(username, password) {
            requireLoaded();
            // Derive even for an unknown username to avoid a cheap username oracle.
            return state !== null && await matches(password, state.password) && username === state.username;
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
        replaceCredentials(recoveryKey, password) {
            return serialize(async () => {
                requireLoaded();
                if (!state || !await matches(recoveryKey, state.recovery)) return null;
                const next = await recordFor(state.username, password);
                await persist(next.record, false);
                return next.recoveryKey;
            });
        },
    };
}

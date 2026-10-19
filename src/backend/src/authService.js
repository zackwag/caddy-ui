import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from './AppError.js';
import { createAuthStore, validateCredentials } from './authStore.js';
import { createAuthSessions } from './authSessions.js';
import { API_TOKEN_SCOPES, MAX_API_TOKENS, validApiTokenInput } from './apiTokenPolicy.js';
import { getInstances } from './instances.js';
import logger from './logger.js';

function sameSecret(actual, expected) {
    if (typeof actual !== 'string') return false;
    const hash = value => createHash('sha256').update(value).digest();
    return timingSafeEqual(hash(actual), hash(expected));
}

export async function createAuthService({ store = createAuthStore(), env = process.env, sessions } = {}) {
    await store.loadAuth();
    let legacy = null;
    if (!store.isInitialized()) {
        const names = ['CADDY_UI_USER', 'CADDY_UI_PASSWORD', 'JWT_SECRET'];
        const provided = names.filter(name => env[name] !== undefined);
        const invalid = names.filter(name => !env[name]?.trim());
        if (provided.length && invalid.length) {
            throw new Error(`Authentication configuration is incomplete or invalid. Refusing to start. Missing, empty or whitespace-only: ${invalid.join(', ')}. Supply all three legacy variables or remove all three for credential setup.`);
        }
        if (provided.length) legacy = { username: env.CADDY_UI_USER, password: env.CADDY_UI_PASSWORD };
    }
    sessions ??= createAuthSessions({ secure: Boolean(env.CADDY_UI_EXTERNAL_URL && new URL(env.CADDY_UI_EXTERNAL_URL).protocol === 'https:') });
    let operations = Promise.resolve();
    function serialize(operation) {
        const result = operations.then(operation);
        operations = result.catch(() => {});
        return result;
    }
    function validate(username, password) {
        try { validateCredentials(username, password); }
        catch { throw new AppError('VALIDATION_FAILED'); }
    }
    async function persist(operation) {
        try { return await operation(); }
        catch (cause) { throw new AppError('AUTH_PERSISTENCE_FAILED', { cause }); }
    }

    return {
        sessions,
        verifyApiToken(token) { return store.verifyApiToken(token); },
        // Token metadata for background monitors, which have no request to authorize.
        apiTokenMetadata() { return store.listApiTokens(); },
        getCredentials(req, res) {
            this.requireManagement(req, res);
            return { username: store.getUsername() };
        },
        updateCredentials(req, res, input) {
            return serialize(async () => {
                const unwatch = this.requireManagement(req, res);
                if (!input || typeof input !== 'object' || Array.isArray(input)
                    || typeof input.currentPassword !== 'string'
                    || (input.username === undefined && input.password === undefined)) {
                    throw new AppError('VALIDATION_FAILED');
                }
                const currentUsername = store.getUsername();
                if (!await store.verifyPassword(currentUsername, input.currentPassword)) {
                    throw new AppError('CURRENT_PASSWORD_INVALID');
                }
                const username = input.username === undefined ? currentUsername : input.username;
                validate(username, input.password === undefined ? input.currentPassword : input.password);
                await persist(() => store.updateCredentials(username, input.password));
                // Keep this response open while closing every old session/stream.
                unwatch();
                sessions.revokeAllSessions();
                sessions.createSession(req, res, 'management');
                return { username };
            });
        },
        listApiTokens(req, res) {
            this.requireManagement(req, res);
            return { tokens: store.listApiTokens(), scopes: API_TOKEN_SCOPES };
        },
        issueApiToken(req, res, input) {
            return serialize(async () => {
                this.requireManagement(req, res);
                if (!validApiTokenInput(input) || input.instanceIds.some(id => !getInstances().some(instance => instance.id === id))) {
                    throw new AppError('VALIDATION_FAILED');
                }
                if (store.listApiTokens().length >= MAX_API_TOKENS) throw new AppError('CONFLICT');
                const issued = await persist(() => store.issueApiToken(input));
                logger.info('API token created', { tokenId: issued.id, scopes: issued.scopes, instanceIds: issued.instanceIds });
                return issued;
            });
        },
        revokeApiToken(req, res, id) {
            return serialize(async () => {
                this.requireManagement(req, res);
                if (!await persist(() => store.revokeApiToken(id))) throw new AppError('NOT_FOUND');
                logger.info('API token revoked', { tokenId: id });
            });
        },
        getAuthState(req) {
            const session = sessions.readSession(req);
            return {
                authEnabled: true,
                authenticated: session?.permission === 'management',
                setupRequired: !store.isInitialized(),
                enrollmentRequired: !store.isInitialized() && legacy !== null,
                enrollmentAuthenticated: session?.permission === 'enrollment',
                publicMetrics: env.CADDY_UI_PUBLIC_METRICS === 'true',
            };
        },
        requireManagement(req, res) {
            const session = sessions.readSession(req);
            if (session?.permission !== 'management') throw new AppError('UNAUTHORIZED');
            return sessions.watchSession(session, res);
        },
        login(req, res, { username, password } = {}) {
            return serialize(async () => {
                let permission;
                if (store.isInitialized()) {
                    if (!await store.verifyPassword(username, password)) throw new AppError('UNAUTHORIZED');
                    permission = 'management';
                } else {
                    if (!legacy || !sameSecret(username, legacy.username) || !sameSecret(password, legacy.password)) {
                        throw new AppError('UNAUTHORIZED');
                    }
                    permission = 'enrollment';
                }
                sessions.createSession(req, res, permission);
            });
        },
        completeSetup(req, res, { username, password } = {}) {
            return serialize(async () => {
                if (store.isInitialized()) throw new AppError('CONFLICT');
                if (legacy && sessions.readSession(req)?.permission !== 'enrollment') throw new AppError('UNAUTHORIZED');
                validate(username, password);
                const recoveryKey = await persist(() => store.initializeAuth(username, password));
                legacy = null;
                sessions.revokeAllSessions();
                sessions.createSession(req, res, 'management');
                return recoveryKey;
            });
        },
        recoverPassword(req, res, { recoveryKey, password } = {}) {
            return serialize(async () => {
                validate(store.getUsername() || 'administrator', password);
                const replacement = await persist(() => store.replaceCredentials(recoveryKey, password));
                if (!replacement) throw new AppError('UNAUTHORIZED');
                sessions.revokeAllSessions();
                sessions.revokeSession(req, res);
                return replacement;
            });
        },
        logout(req, res) { sessions.revokeSession(req, res); },
    };
}

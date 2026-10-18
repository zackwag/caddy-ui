import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from './AppError.js';
import { createAuthStore, validateCredentials } from './authStore.js';
import { createAuthSessions } from './authSessions.js';

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
            sessions.watchSession(session, res);
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

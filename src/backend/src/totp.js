import { AppError } from './AppError.js';
import { recordAuthentication } from './authEvents.js';
import { createTotpEnrollment, totpStep, TOTP_ATTEMPTS, TOTP_CHALLENGE_MS } from './totpPolicy.js';

// Proposed seeds and password-only login contexts stay in bounded, process-local
// sessions. Neither grants management access or survives a backend restart.
export function createTotpService({ store, sessions, serialize, persist, requireManagement, authorizeChange, now }) {
    function pending(req, kind) {
        const session = sessions.readSession(req);
        const value = session?.[kind];
        return value && value.expires > now() && value.attempts < TOTP_ATTEMPTS ? value : null;
    }
    return {
        loginPending(req) { return sessions.readSession(req)?.permission === 'totp' && !!pending(req, 'totpLogin'); },
        async beginLogin(req, res) {
            await persist(() => store.assertTotpAvailable());
            const session = sessions.createSession(req, res, 'totp');
            session.totpLogin = { expires: now() + TOTP_CHALLENGE_MS, attempts: 0 };
            return { totpRequired: true };
        },
        completeLogin(req, res, input) {
            return serialize(async () => {
                const value = pending(req, 'totpLogin');
                if (sessions.readSession(req)?.permission !== 'totp' || !value) {
                    sessions.revokeSession(req, res);
                    throw new AppError('TOTP_CHALLENGE_EXPIRED');
                }
                value.attempts++;
                if (!await persist(() => store.consumeTotp(input?.code))) {
                    recordAuthentication(req, 'totp', 'failure');
                    if (value.attempts >= TOTP_ATTEMPTS) {
                        sessions.revokeSession(req, res);
                        throw new AppError('TOTP_CHALLENGE_EXPIRED');
                    }
                    throw new AppError('TOTP_INVALID');
                }
                sessions.createSession(req, res, 'management');
                recordAuthentication(req, 'password-totp', 'success', store.listPasskeys().length > 0);
            });
        },
        setup(req, res, input) {
            return serialize(async () => {
                requireManagement(req, res);
                const session = sessions.readSession(req);
                delete session.totpSetup;
                await authorizeChange(req, input, 'totp.setup');
                const enrollment = createTotpEnrollment(store.getUsername());
                const expires = now() + TOTP_CHALLENGE_MS;
                session.totpSetup = { secret: enrollment.secret, expires, attempts: 0 };
                return { ...enrollment, expiresAt: new Date(expires).toISOString() };
            });
        },
        confirm(req, res, input) {
            return serialize(async () => {
                const unwatch = requireManagement(req, res);
                const value = pending(req, 'totpSetup');
                if (!value) {
                    delete sessions.readSession(req).totpSetup;
                    throw new AppError('TOTP_SETUP_EXPIRED');
                }
                value.attempts++;
                const step = totpStep(value.secret, input?.code, now());
                if (step === null) {
                    if (value.attempts >= TOTP_ATTEMPTS) {
                        delete sessions.readSession(req).totpSetup;
                        throw new AppError('TOTP_SETUP_EXPIRED');
                    }
                    throw new AppError('TOTP_INVALID');
                }
                await persist(() => store.setTotp({ secret: value.secret, lastAcceptedStep: step, createdAt: new Date(now()).toISOString() }));
                unwatch();
                sessions.revokeAllSessions();
                sessions.createSession(req, res, 'management');
            });
        },
        cancel(req, res) {
            return serialize(() => {
                requireManagement(req, res);
                delete sessions.readSession(req).totpSetup;
            });
        },
        disable(req, res, input) {
            return serialize(async () => {
                const unwatch = requireManagement(req, res);
                if (!store.isTotpEnabled()) throw new AppError('CONFLICT');
                await authorizeChange(req, input, 'totp.disable');
                await persist(() => store.setTotp(null));
                unwatch();
                sessions.revokeAllSessions();
                sessions.createSession(req, res, 'management');
            });
        },
    };
}

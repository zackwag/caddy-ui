import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { isIP } from 'node:net';
import { AppError } from './AppError.js';
import { MAX_PASSKEYS, PASSKEY_ALGORITHMS, passkeyMetadata, validPasskeyName, validPasskeyRecord } from './passkeyPolicy.js';
import { recordAuthentication } from './authEvents.js';

const CHALLENGE_MS = 2 * 60 * 1000;

// State is attached to existing, bounded sessions: no separate anonymous challenge cache.
export function createPasskeyService({ store, sessions, env, serialize, persist, requireManagement, now = Date.now }) {
    const configured = env.CADDY_UI_EXTERNAL_URL
        ? env.CADDY_UI_EXTERNAL_URL.split(',').map(u => { try { return new URL(u.trim()); } catch { return null; } }).filter(Boolean)
        : [];
    const passkeyUrl = configured.find(u => u.protocol === 'https:' && !isIP(u.hostname.replace(/^\[|\]$/g, ''))) ?? null;
    const ipHost = configured.length > 0 && !passkeyUrl && configured.every(u => isIP(u.hostname.replace(/^\[|\]$/g, '')));
    const origin = passkeyUrl?.origin ?? null;
    const rpID = passkeyUrl?.hostname ?? null;

    function requireEnabled() {
        if (ipHost) throw new AppError('PASSKEY_IP_UNAVAILABLE');
        if (!origin || !store.isInitialized()) throw new AppError('PASSKEY_UNAVAILABLE');
    }
    function takeChallenge(req, kind) {
        const session = sessions.readSession(req);
        const pending = session?.passkeyChallenge;
        if (session) delete session.passkeyChallenge;
        if (!pending || pending.kind !== kind || pending.expires <= now()) throw new AppError('PASSKEY_INVALID');
        return pending;
    }
    async function requirePassword(input) {
        if (!await store.verifyPassword(store.getUsername(), input?.currentPassword)) throw new AppError('CURRENT_PASSWORD_INVALID');
    }
    function rejectEmbeddedResponse(response) {
        const client = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'));
        if (client.crossOrigin || client.topOrigin) throw new Error('Embedded passkey ceremony is not supported');
    }

    return {
        state() {
            return { passkeyOrigin: origin, passkeyUnavailableReason: ipHost ? 'ip-address' : null,
                passkeyLoginAvailable: !!origin && store.hasPasskey(rpID) };
        },
        list(req, res) {
            requireManagement(req, res);
            return { enabled: !!origin, origin, unavailableReason: ipHost ? 'ip-address' : null,
                limit: MAX_PASSKEYS, passkeys: store.listPasskeys().map(passkeyMetadata) };
        },
        registrationOptions(req, res, input) {
            return serialize(async () => {
                requireManagement(req, res);
                const session = sessions.readSession(req);
                // An unsuccessful new attempt must not leave an earlier password authorization usable.
                delete session.passkeyChallenge;
                requireEnabled();
                if (!validPasskeyName(input?.name)) throw new AppError('VALIDATION_FAILED');
                await requirePassword(input);
                if (store.listPasskeys().length >= MAX_PASSKEYS) throw new AppError('PASSKEY_LIMIT');
                const userId = await persist(() => store.ensurePasskeyUserId());
                const options = await generateRegistrationOptions({ rpName: 'Caddy UI', rpID,
                    userName: store.getUsername(), userID: Buffer.from(userId, 'base64url'),
                    timeout: CHALLENGE_MS, attestationType: 'none', supportedAlgorithmIDs: PASSKEY_ALGORITHMS,
                    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
                    excludeCredentials: store.listPasskeys().filter(key => key.rpId === rpID).map(key => ({ id: key.id })),
                });
                session.passkeyChallenge = { kind: 'registration', challenge: options.challenge,
                    expires: now() + CHALLENGE_MS, name: input.name.trim(), userId };
                return options;
            });
        },
        register(req, res, response) {
            return serialize(async () => {
                requireManagement(req, res);
                requireEnabled();
                const pending = takeChallenge(req, 'registration');
                if (store.listPasskeys().length >= MAX_PASSKEYS) throw new AppError('PASSKEY_LIMIT');
                let result;
                try {
                    rejectEmbeddedResponse(response);
                    result = await verifyRegistrationResponse({ response, expectedChallenge: pending.challenge,
                        expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
                        supportedAlgorithmIDs: PASSKEY_ALGORITHMS });
                } catch { throw new AppError('PASSKEY_INVALID'); }
                if (!result.verified || pending.userId !== store.getPasskeyUserId()) throw new AppError('PASSKEY_INVALID');
                const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
                if (store.listPasskeys().some(key => key.id === credential.id)) throw new AppError('PASSKEY_INVALID');
                const record = { id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'),
                    counter: credential.counter, transports: credential.transports ?? [],
                    name: pending.name, rpId: rpID, deviceType: credentialDeviceType, backedUp: credentialBackedUp,
                    createdAt: new Date(now()).toISOString(), lastUsedAt: null };
                if (!validPasskeyRecord(record)) throw new AppError('PASSKEY_INVALID');
                await persist(() => store.addPasskey(record));
                return passkeyMetadata(record);
            });
        },
        authenticationOptions(req) {
            return serialize(async () => {
                requireEnabled();
                const session = sessions.readSession(req);
                if (session?.permission !== 'anonymous') throw new AppError('PASSKEY_INVALID');
                delete session.passkeyChallenge;
                // Discoverable credentials avoid publishing the administrator's credential IDs.
                const options = await generateAuthenticationOptions({ rpID, timeout: CHALLENGE_MS, userVerification: 'required' });
                session.passkeyChallenge = { kind: 'authentication', challenge: options.challenge, expires: now() + CHALLENGE_MS };
                return options;
            });
        },
        authenticate(req, res, response) {
            return serialize(async () => {
                requireEnabled();
                if (sessions.readSession(req)?.permission !== 'anonymous') throw new AppError('PASSKEY_INVALID');
                const pending = takeChallenge(req, 'authentication');
                const record = store.listPasskeys().find(key => key.id === response?.id && key.rpId === rpID);
                if (!record || response?.response?.userHandle !== store.getPasskeyUserId()) throw new AppError('PASSKEY_INVALID');
                let result;
                try {
                    rejectEmbeddedResponse(response);
                    result = await verifyAuthenticationResponse({ response, expectedChallenge: pending.challenge,
                        expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
                        credential: { id: record.id, publicKey: Buffer.from(record.publicKey, 'base64url'),
                            counter: record.counter, transports: record.transports } });
                } catch { throw new AppError('PASSKEY_INVALID'); }
                if (!result.verified) throw new AppError('PASSKEY_INVALID');
                // Persist replay protection before issuing a management session.
                await persist(() => store.updatePasskeyUsage(record.id, result.authenticationInfo));
                sessions.createSession(req, res, 'management');
            }).then(() => recordAuthentication(req, 'passkey', 'success'), error => {
                if (error.code === 'PASSKEY_INVALID') recordAuthentication(req, 'passkey', 'failure');
                throw error;
            });
        },
        remove(req, res, id, input) {
            return serialize(async () => {
                const unwatch = requireManagement(req, res);
                const keys = store.listPasskeys();
                if (!keys.some(key => key.id === id)) throw new AppError('NOT_FOUND');
                await requirePassword(input);
                await persist(() => store.removePasskey(id));
                // Removing a lost credential also ends sessions it may already have opened.
                unwatch();
                sessions.revokeAllSessions();
                sessions.createSession(req, res, 'management');
            });
        },
    };
}

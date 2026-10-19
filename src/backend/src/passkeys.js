import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { AppError } from './AppError.js';
import { MAX_PASSKEYS, PASSKEY_ALGORITHMS, passkeyMetadata, validPasskeyName } from './passkeyPolicy.js';

const CHALLENGE_MS = 2 * 60 * 1000;

// State is attached to existing, bounded sessions: no separate anonymous challenge cache.
export function createPasskeyService({ store, sessions, env, serialize, persist, now = Date.now }) {
    const configured = env.CADDY_UI_EXTERNAL_URL ? new URL(env.CADDY_UI_EXTERNAL_URL) : null;
    const origin = configured?.protocol === 'https:' ? configured.origin : null;
    const rpID = origin ? configured.hostname : null;

    function requireEnabled() {
        if (!origin || !store.isInitialized()) throw new AppError('PASSKEY_UNAVAILABLE');
    }
    function management(req, res) {
        const session = sessions.readSession(req);
        if (session?.permission !== 'management') throw new AppError('UNAUTHORIZED');
        return { session, unwatch: sessions.watchSession(session, res) };
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
            return { passkeysEnabled: !!origin,
                passkeyLoginAvailable: !!origin && store.listPasskeys().some(key => key.rpId === rpID) };
        },
        list(req, res) {
            management(req, res);
            return { enabled: !!origin, limit: MAX_PASSKEYS, passkeys: store.listPasskeys().map(passkeyMetadata) };
        },
        registrationOptions(req, res, input) {
            return serialize(async () => {
                const { session } = management(req, res);
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
                management(req, res);
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
                if (store.listPasskeys().some(key => key.id === credential.id)) throw new AppError('CONFLICT');
                const record = { id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'),
                    counter: credential.counter, transports: (credential.transports || []).slice(0, 8),
                    name: pending.name, rpId: rpID, deviceType: credentialDeviceType, backedUp: credentialBackedUp,
                    createdAt: new Date(now()).toISOString(), lastUsedAt: null };
                await persist(() => store.addPasskey(record));
                return passkeyMetadata(record);
            });
        },
        remove(req, res, id, input) {
            return serialize(async () => {
                const { unwatch } = management(req, res);
                const keys = store.listPasskeys();
                if (!keys.some(key => key.id === id)) throw new AppError('NOT_FOUND');
                if (keys.length === 1) await requirePassword(input);
                await persist(() => store.removePasskey(id));
                // Removing a lost credential also ends sessions it may already have opened.
                unwatch();
                sessions.revokeAllSessions();
                sessions.createSession(req, res, 'management');
            });
        },
    };
}

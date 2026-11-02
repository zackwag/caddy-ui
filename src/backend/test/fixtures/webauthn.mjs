import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const hash = value => createHash('sha256').update(value).digest();
const encoded = value => Buffer.from(value).toString('base64url');

// Real ES256 signatures and CBOR attestation data, verified by SimpleWebAuthn.
export function authenticator() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    const cose = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1],
        [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const id = randomBytes(32);
    let userId;
    return {
        registration(options, { origin = 'https://ui.example.com', rpId = options.rp.id, verified = true, crossOrigin = false } = {}) {
            userId = options.user.id;
            const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin }));
            const length = Buffer.alloc(2);
            length.writeUInt16BE(id.length);
            const authData = Buffer.concat([hash(rpId), Buffer.from([verified ? 0x45 : 0x41]), Buffer.alloc(4), Buffer.alloc(16), length, id, cose]);
            return { id: encoded(id), rawId: encoded(id), type: 'public-key', clientExtensionResults: {},
                response: { clientDataJSON: encoded(clientDataJSON), transports: ['internal'],
                    attestationObject: encoded(isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))) } };
        },
        assertion(options, { origin = 'https://ui.example.com', rpId = options.rpId, verified = true, counter = 1,
            challenge = options.challenge, userHandle = userId, crossOrigin = false } = {}) {
            const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin }));
            const count = Buffer.alloc(4);
            count.writeUInt32BE(counter);
            const authData = Buffer.concat([hash(rpId), Buffer.from([verified ? 5 : 1]), count]);
            return { id: encoded(id), rawId: encoded(id), type: 'public-key', clientExtensionResults: {},
                response: { clientDataJSON: encoded(clientDataJSON), authenticatorData: encoded(authData), userHandle,
                    signature: encoded(sign('sha256', Buffer.concat([authData, hash(clientDataJSON)]), privateKey)) } };
        },
    };
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { passkeySupport, reauthenticateWithPasskey } = vi.hoisted(() => ({ passkeySupport: vi.fn(), reauthenticateWithPasskey: vi.fn() }));
vi.mock('../src/utils/passkeys.js', () => ({ passkeySupport, reauthenticateWithPasskey }));
import { canVerifyWithPasskey, credentialProof, verificationMethod, verificationReady } from '../src/utils/credentialVerification.js';

const state = { totpEnabled: true, passkeyLoginAvailable: true, passkeyOrigin: 'https://ui.example.com' };
beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('window', { location: { origin: state.passkeyOrigin } });
    passkeySupport.mockReturnValue({ secure: true, supported: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('credential verification choices', () => {
    it('prefers a compatible passkey, but permits the password and TOTP fallback', () => {
        expect(verificationMethod({}, state)).toBe('passkey');
        expect(verificationReady({}, state)).toBe(true);
        const password = { method: 'password', currentPassword: 'unused' };
        expect(verificationReady(password, state)).toBe(false);
        expect(verificationReady({ ...password, totpCode: '123456' }, state)).toBe(true);
        expect(verificationReady({ ...password, totpCode: '12345' }, state)).toBe(false);
    });
    it('requires actual secure browser support and matching origin to offer a passkey', () => {
        expect(canVerifyWithPasskey({ ...state, passkeyOrigin: 'https://elsewhere.example.com' })).toBe(false);
        passkeySupport.mockReturnValue({ secure: false, supported: true });
        expect(verificationMethod({}, state)).toBe('password');
        passkeySupport.mockReturnValue({ secure: true, supported: false });
        expect(canVerifyWithPasskey(state)).toBe(false);
        expect(verificationReady({}, null)).toBe(false);
    });
    it('sends a fresh action-bound passkey proof without retained password/code fields', async () => {
        const onUnauth = vi.fn();
        reauthenticateWithPasskey.mockResolvedValue({ reauthToken: 'grant' });
        expect(await credentialProof({ currentPassword: 'unused', totpCode: '123456' }, state, 'totp.disable', onUnauth)).toEqual({ reauthToken: 'grant' });
        expect(reauthenticateWithPasskey).toHaveBeenCalledWith('totp.disable', onUnauth);
    });
    it('does not invoke WebAuthn when the password fallback was chosen', async () => {
        const value = { method: 'password', currentPassword: 'unused', totpCode: '123456' };
        expect(await credentialProof(value, state, 'totp.disable')).toEqual({ currentPassword: 'unused', totpCode: '123456' });
        expect(reauthenticateWithPasskey).not.toHaveBeenCalled();
    });
});

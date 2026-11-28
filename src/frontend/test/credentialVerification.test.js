import { beforeEach, describe, expect, it, vi } from 'vitest';
const { passkeyProblem, reauthenticateWithPasskey } = vi.hoisted(() => ({ passkeyProblem: vi.fn(), reauthenticateWithPasskey: vi.fn() }));
vi.mock('../src/utils/passkeys.js', () => ({ passkeyProblem, reauthenticateWithPasskey }));
import { credentialProof, requireMatchingPasswords, verificationMethod, verificationReady } from '../src/utils/credentialVerification.js';

const state = { totpEnabled: true, passkeyLoginAvailable: true, passkeyOrigin: 'https://ui.example.com' };
beforeEach(() => {
    vi.resetAllMocks();
    passkeyProblem.mockReturnValue(null);
});

describe('credential verification choices', () => {
    it('prefers a compatible passkey, but permits the password and TOTP fallback', () => {
        expect(verificationMethod({}, state)).toBe('passkey');
        expect(verificationReady({}, state)).toBe(true);
        const password = { method: 'password', currentPassword: 'unused' };
        expect(verificationReady(password, state)).toBe(false);
        expect(verificationReady({ ...password, totpCode: '123456' }, state)).toBe(true);
        expect(verificationReady({ ...password, totpCode: '12345' }, state)).toBe(false);
    });
    it('takes the password when a passkey is missing or cannot be used here', () => {
        expect(verificationMethod({}, { ...state, passkeyLoginAvailable: false })).toBe('password');
        passkeyProblem.mockReturnValue({ key: 'passkeys.httpsRequired' });
        expect(verificationMethod({}, state)).toBe('password');
        expect(passkeyProblem).toHaveBeenCalledWith({ origin: state.passkeyOrigin });
        expect(verificationReady({}, null)).toBe(false);
    });
    it('requires a new password to be entered the same way twice', () => {
        expect(() => requireMatchingPasswords({ password: 'one', confirmation: 'two' })).toThrow(expect.objectContaining({ code: 'PASSWORD_MISMATCH' }));
        expect(() => requireMatchingPasswords({ password: 'one' })).toThrow();
        requireMatchingPasswords({ password: 'one', confirmation: 'one' });
        requireMatchingPasswords({});
    });
    it('sends a fresh action-bound passkey proof without retained password/code fields', async () => {
        reauthenticateWithPasskey.mockResolvedValue({ reauthToken: 'grant' });
        expect(await credentialProof({ currentPassword: 'unused', totpCode: '123456' }, state, 'totp.disable')).toEqual({ reauthToken: 'grant' });
        expect(reauthenticateWithPasskey).toHaveBeenCalledWith('totp.disable');
    });
    it('does not invoke WebAuthn when the password fallback was chosen', async () => {
        const value = { method: 'password', currentPassword: 'unused', totpCode: '123456' };
        expect(await credentialProof(value, state, 'totp.disable')).toEqual({ currentPassword: 'unused', totpCode: '123456' });
        expect(reauthenticateWithPasskey).not.toHaveBeenCalled();
    });
});

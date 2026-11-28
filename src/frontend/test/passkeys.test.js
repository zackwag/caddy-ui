import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { authRequest, browserSupportsWebAuthn, startRegistration, startAuthentication } = vi.hoisted(() => ({
    authRequest: vi.fn(), browserSupportsWebAuthn: vi.fn(), startRegistration: vi.fn(), startAuthentication: vi.fn(),
}));
vi.mock('../src/utils/api.js', async importOriginal => ({ ...await importOriginal(), authRequest }));
vi.mock('@simplewebauthn/browser', () => ({ startRegistration, startAuthentication, browserSupportsWebAuthn }));
import { passkeyProblem, reauthenticateWithPasskey, registerPasskey, signInWithPasskey } from '../src/utils/passkeys.js';

beforeEach(() => vi.resetAllMocks());
describe('passkey browser request failures', () => {
    it('keeps cancellation recoverable and never submits an incomplete registration', async () => {
        authRequest.mockResolvedValueOnce({ challenge: 'challenge' });
        startRegistration.mockRejectedValueOnce({ cause: { name: 'NotAllowedError' } });
        await expect(registerPasskey('Laptop', 'unused')).rejects.toMatchObject({ code: 'PASSKEY_CANCELLED' });
        expect(authRequest).toHaveBeenCalledTimes(1);
    });
    it('does not open the device prompt after a server-side password rejection', async () => {
        authRequest.mockRejectedValueOnce({ code: 'CURRENT_PASSWORD_INVALID' });
        await expect(registerPasskey('Laptop', 'unused')).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' });
        expect(startRegistration).not.toHaveBeenCalled();
    });
    it('preserves persistence failures after a completed device ceremony without retrying the write', async () => {
        authRequest.mockResolvedValueOnce({ challenge: 'challenge' }).mockRejectedValueOnce({ code: 'AUTH_PERSISTENCE_FAILED' });
        startRegistration.mockResolvedValueOnce({ id: 'credential' });
        await expect(registerPasskey('Laptop', 'unused')).rejects.toMatchObject({ code: 'AUTH_PERSISTENCE_FAILED' });
        expect(authRequest).toHaveBeenCalledTimes(2);
    });
    it('does not turn a rejected assertion into a successful sign-in', async () => {
        authRequest.mockResolvedValueOnce({ challenge: 'challenge' }).mockRejectedValueOnce({ code: 'PASSKEY_INVALID' });
        startAuthentication.mockResolvedValueOnce({ id: 'credential' });
        await expect(signInWithPasskey()).rejects.toMatchObject({ code: 'PASSKEY_INVALID' });
        expect(authRequest).toHaveBeenCalledTimes(2);
    });
    it('does not issue a reauthentication grant after a cancelled device prompt', async () => {
        authRequest.mockResolvedValueOnce({ challenge: 'challenge' });
        startAuthentication.mockRejectedValueOnce({ name: 'NotAllowedError' });
        await expect(reauthenticateWithPasskey('password.change')).rejects.toMatchObject({ code: 'PASSKEY_CANCELLED' });
        expect(authRequest).toHaveBeenCalledTimes(1);
        expect(authRequest.mock.calls[0][1].json).toEqual({ action: 'password.change' });
    });

});

describe('using a passkey on this page', () => {
    const origin = 'https://ui.example.com';
    const page = overrides => vi.stubGlobal('window', { location: { protocol: 'https:', origin }, isSecureContext: true, ...overrides });
    beforeEach(() => {
        page();
        browserSupportsWebAuthn.mockReturnValue(true);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('is possible on the origin it was registered for', () => {
        expect(passkeyProblem({ origin })).toBeNull();
    });
    it.each([
        ['over plain HTTP', { location: { protocol: 'http:', origin } }],
        ['outside a secure context', { isSecureContext: false }],
    ])('needs HTTPS (%s)', (_name, overrides) => {
        page(overrides);
        expect(passkeyProblem({ origin })).toEqual({ key: 'passkeys.httpsRequired' });
    });
    it('needs a browser that supports it', () => {
        browserSupportsWebAuthn.mockReturnValue(false);
        expect(passkeyProblem({ origin })).toEqual({ key: 'passkeys.unsupported' });
    });
    it.each([
        [{ origin: null, reason: 'ip-address', enabled: false }, 'errors.passkeyIpUnavailable'],
        [{ origin: null, enabled: false }, 'errors.passkeyUnavailable'],
    ])('needs a backend configured for it (%o)', (configuration, key) => {
        expect(passkeyProblem(configuration)).toEqual({ key });
    });
    it('names the origin to open instead', () => {
        expect(passkeyProblem({ origin: 'https://other.example.com' })).toEqual({ key: 'passkeys.originMismatch', values: { origin: 'https://other.example.com' } });
    });
});

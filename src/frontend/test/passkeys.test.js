import { beforeEach, describe, expect, it, vi } from 'vitest';
const { authRequest, startRegistration, startAuthentication } = vi.hoisted(() => ({
    authRequest: vi.fn(), startRegistration: vi.fn(), startAuthentication: vi.fn(),
}));
vi.mock('../src/utils/api.js', async importOriginal => ({ ...await importOriginal(), authRequest }));
vi.mock('@simplewebauthn/browser', () => ({ startRegistration, startAuthentication, browserSupportsWebAuthn: vi.fn() }));
import { registerPasskey, signInWithPasskey } from '../src/utils/passkeys.js';

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
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import logger from '../src/logger.js';
import { onAuthenticationEvent, recordAuthentication } from '../src/authEvents.js';

const listener = vi.fn();
onAuthenticationEvent(listener);
afterEach(() => { vi.restoreAllMocks(); listener.mockReset(); });

describe('authentication event policy', () => {
    it.each([
        ['password', 'success', false, 'info'],
        ['password', 'success', true, 'warn'],
        ['password', 'failure', false, 'warn'],
        ['password-totp', 'success', false, 'info'],
        ['password-totp', 'success', true, 'warn'],
        ['totp', 'failure', false, 'warn'],
        ['passkey', 'success', false, 'info'],
        ['passkey', 'failure', false, 'warn'],
        ['recovery', 'success', false, 'warn'],
        ['recovery', 'failure', false, 'warn'],
    ])('%s %s has a fixed severity (passkeys: %s)', async (method, outcome, keys, severity) => {
        const log = vi.spyOn(logger, severity).mockImplementation(() => {});
        recordAuthentication({ ip: '192.0.2.10' }, method, outcome, keys);
        await Promise.resolve();
        expect(log).toHaveBeenCalledWith('Authentication event', expect.objectContaining({ method, outcome }));
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ method, outcome }));
    });

    it('reports whether passkeys were configured only for successful password sign-ins', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => {});
        vi.spyOn(logger, 'info').mockImplementation(() => {});
        recordAuthentication({}, 'password', 'success', true);
        recordAuthentication({}, 'password-totp', 'success', false);
        recordAuthentication({}, 'password', 'failure', true);
        recordAuthentication({}, 'passkey', 'success', true);
        await Promise.resolve();
        expect(listener.mock.calls.map(([event]) => event.passkeysConfigured)).toEqual([true, false, undefined, undefined]);
    });

    it('copies only safe metadata and ignores raw forwarding headers and submitted fields', async () => {
        const log = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const password = randomBytes(24).toString('base64url');
        const recoveryKey = randomBytes(32).toString('base64url');
        recordAuthentication({ socket: { remoteAddress: '127.0.0.1' },
            headers: { 'x-forwarded-for': '203.0.113.10', cookie: 'private-cookie' },
            body: { username: 'unverified-name', password, recoveryKey, code: '123456', totpCode: '654321', secret: 'private-seed' },
        }, 'recovery', 'failure');
        await Promise.resolve();
        expect(log.mock.calls[0][1]).toEqual({ event: 'authentication', timestamp: expect.any(String),
            method: 'recovery', outcome: 'failure', sourceIp: '127.0.0.1' });
        const payload = JSON.stringify(listener.mock.calls);
        for (const value of ['203.0.113.10', 'private-cookie', 'unverified-name', password, recoveryKey, '123456', '654321', 'private-seed']) {
            expect(payload).not.toContain(value);
        }
    });

    it('uses the address already resolved by Express proxy trust, rejecting malformed addresses', async () => {
        vi.spyOn(logger, 'info').mockImplementation(() => {});
        recordAuthentication({ ip: '2001:db8::1', socket: { remoteAddress: '127.0.0.1' } }, 'passkey', 'success');
        recordAuthentication({ ip: 'malformed\ninjected' }, 'passkey', 'success');
        await Promise.resolve();
        expect(listener.mock.calls.map(([event]) => event.sourceIp)).toEqual(['2001:db8::1', 'unknown']);
    });

    it('contains synchronous and asynchronous notification failures', async () => {
        vi.spyOn(logger, 'info').mockImplementation(() => {});
        const warning = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        listener.mockImplementationOnce(() => { throw new Error('private destination'); })
            .mockRejectedValueOnce(new Error('private provider response'));
        recordAuthentication({}, 'password', 'success');
        recordAuthentication({}, 'passkey', 'success');
        await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(2));
        expect(JSON.stringify(warning.mock.calls)).not.toContain('private');
    });
});

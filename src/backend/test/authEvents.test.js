import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import logger from '../src/logger.js';
import { recordAuthentication } from '../src/authEvents.js';

const { notifyAuthenticationEvent } = vi.hoisted(() => ({ notifyAuthenticationEvent: vi.fn() }));
vi.mock('../src/notifications.js', () => ({ notifyAuthenticationEvent }));
afterEach(() => { vi.restoreAllMocks(); notifyAuthenticationEvent.mockReset(); });

describe('authentication event policy', () => {
    it.each([
        ['password', 'success', false, 'info', 'default'],
        ['password', 'success', true, 'warn', 'high'],
        ['password', 'failure', false, 'warn', 'default'],
        ['passkey', 'success', false, 'info', 'default'],
        ['passkey', 'failure', false, 'warn', 'default'],
        ['recovery', 'success', false, 'warn', 'high'],
        ['recovery', 'failure', false, 'warn', 'high'],
    ])('%s %s has fixed severity and priority (passkeys: %s)', async (method, outcome, keys, severity, priority) => {
        const log = vi.spyOn(logger, severity).mockImplementation(() => {});
        recordAuthentication({ ip: '192.0.2.10' }, method, outcome, keys);
        await Promise.resolve();
        expect(log).toHaveBeenCalledWith('Authentication event', expect.objectContaining({ method, outcome }));
        expect(notifyAuthenticationEvent).toHaveBeenCalledWith(expect.objectContaining({ method, outcome, priority }));
    });

    it('copies only safe metadata and ignores raw forwarding headers and submitted fields', async () => {
        const log = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const password = randomBytes(24).toString('base64url');
        const recoveryKey = randomBytes(32).toString('base64url');
        recordAuthentication({ socket: { remoteAddress: '127.0.0.1' },
            headers: { 'x-forwarded-for': '203.0.113.10', cookie: 'private-cookie' },
            body: { username: 'unverified-name', password, recoveryKey },
        }, 'recovery', 'failure');
        await Promise.resolve();
        expect(log.mock.calls[0][1]).toEqual({ event: 'authentication', timestamp: expect.any(String),
            method: 'recovery', outcome: 'failure', sourceIp: '127.0.0.1' });
        const payload = JSON.stringify(notifyAuthenticationEvent.mock.calls);
        for (const value of ['203.0.113.10', 'private-cookie', 'unverified-name', password, recoveryKey]) {
            expect(payload).not.toContain(value);
        }
    });

    it('uses the address already resolved by Express proxy trust, rejecting malformed addresses', async () => {
        vi.spyOn(logger, 'info').mockImplementation(() => {});
        recordAuthentication({ ip: '2001:db8::1', socket: { remoteAddress: '127.0.0.1' } }, 'passkey', 'success');
        recordAuthentication({ ip: 'malformed\ninjected' }, 'passkey', 'success');
        await Promise.resolve();
        expect(notifyAuthenticationEvent.mock.calls.map(([event]) => event.sourceIp)).toEqual(['2001:db8::1', 'unknown']);
    });

    it('contains synchronous and asynchronous notification failures', async () => {
        vi.spyOn(logger, 'info').mockImplementation(() => {});
        const warning = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        notifyAuthenticationEvent.mockImplementationOnce(() => { throw new Error('private destination'); })
            .mockRejectedValueOnce(new Error('private provider response'));
        recordAuthentication({}, 'password', 'success');
        recordAuthentication({}, 'passkey', 'success');
        await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(2));
        expect(JSON.stringify(warning.mock.calls)).not.toContain('private');
    });
});

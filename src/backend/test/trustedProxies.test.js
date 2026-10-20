import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createProxyTrust, parseTrustedProxies } from '../src/trustedProxies.js';

describe('trusted proxy configuration', () => {
    it.each([undefined, '', '  '])('ignores forwarded addresses by default (%j)', value => {
        expect(parseTrustedProxies(value)).toBe(false);
    });

    it('accepts explicit IPv4/IPv6 proxies and CIDRs with whitespace', () => {
        const addresses = parseTrustedProxies(' 192.0.2.5, 198.51.100.0/24, ::1, 2001:db8::/32 ');
        const app = express();
        app.set('trust proxy', addresses);
        const trusts = app.get('trust proxy fn');
        for (const address of ['192.0.2.5', '::ffff:192.0.2.5', '198.51.100.7', '::1', '2001:db8::1']) {
            expect(trusts(address)).toBe(true);
        }
        for (const address of ['192.0.2.6', '203.0.113.7', '2001:db9::1']) expect(trusts(address)).toBe(false);
    });

    it.each(['true', 'false', '1', '-1', 'loopback', 'localhost', 'http://proxy:80', ',',
        '192.0.2.5,', '192.0.2.5/33', '::1/129', '192.0.2.5/-1', '::1/',
        '192.0.2.5/24/1', '192.0.2.5/01', 'not-an-address', '0.0.0.0/0', '::/0',
        '::ffff:192.0.2.5/64', '0:0:0:0:0:ffff:c000:205/64'])('fails closed on invalid setting %j', value => {
        expect(() => parseTrustedProxies(value)).toThrow('CADDY_UI_TRUSTED_PROXIES');
    });

    it('accepts useful IPv4-mapped IPv6 CIDRs', () => {
        const addresses = parseTrustedProxies('::ffff:192.0.2.0/120');
        const trusts = express().set('trust proxy', addresses).get('trust proxy fn');
        expect(trusts('192.0.2.5')).toBe(true);
        expect(trusts('198.51.100.5')).toBe(false);
    });

    it('discovers only the bundled frontend and trusts it only as the immediate hop', async () => {
        const resolve = vi.fn().mockResolvedValue([{ address: '192.0.2.5' }]);
        const policy = await createProxyTrust(undefined, { resolve });
        try {
            expect(resolve).toHaveBeenCalledWith('caddy-ui-frontend', { all: true });
            expect(policy.trust('192.0.2.5', 0)).toBe(true);
            expect(policy.trust('::ffff:192.0.2.5', 0)).toBe(true);
            expect(policy.trust('192.0.2.5', 1)).toBe(false);
            expect(policy.trust('192.0.2.6', 0)).toBe(false);
        } finally { policy.close(); }
    });

    it('refreshes frontend addresses and fails closed when discovery stops working', async () => {
        vi.useFakeTimers();
        const resolve = vi.fn().mockResolvedValueOnce([{ address: '192.0.2.5' }])
            .mockResolvedValueOnce([{ address: '192.0.2.6' }]).mockRejectedValue(new Error('DNS unavailable'));
        const policy = await createProxyTrust(undefined, { resolve, refreshMs: 1000 });
        try {
            await vi.advanceTimersByTimeAsync(1000);
            expect(policy.trust('192.0.2.5', 0)).toBe(false);
            expect(policy.trust('192.0.2.6', 0)).toBe(true);
            await vi.advanceTimersByTimeAsync(1000);
            expect(policy.trust('192.0.2.6', 0)).toBe(false);
        } finally { policy.close(); vi.useRealTimers(); }
    });

    it('keeps direct-only mode when the bundled frontend cannot be resolved', async () => {
        const policy = await createProxyTrust(undefined, { resolve: async () => { throw new Error('not found'); } });
        try { expect(policy.trust('127.0.0.1', 0)).toBe(false); }
        finally { policy.close(); }
    });

    it.each(['', '192.0.2.5'])('uses explicit configuration without frontend discovery (%j)', async value => {
        const resolve = vi.fn();
        const policy = await createProxyTrust(value, { resolve });
        expect(policy.trust('192.0.2.5', 0)).toBe(Boolean(value));
        expect(resolve).not.toHaveBeenCalled();
        policy.close();
    });
});

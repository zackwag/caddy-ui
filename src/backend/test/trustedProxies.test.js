import express from 'express';
import { describe, expect, it } from 'vitest';
import { parseTrustedProxies } from '../src/trustedProxies.js';

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
        '192.0.2.5/24/1', '192.0.2.5/01', 'not-an-address'])('fails closed on invalid setting %j', value => {
        expect(() => parseTrustedProxies(value)).toThrow('CADDY_UI_TRUSTED_PROXIES');
    });
});

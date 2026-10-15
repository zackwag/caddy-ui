import { afterEach, describe, it, expect, vi } from 'vitest';
import { validateSite, labelHosts, collides, renderState, hybridEnabled, hybridGuard, serial, certificatePair } from '../src/hybrid.js';

afterEach(() => vi.unstubAllEnvs());

describe('hybrid opt-in', () => {
    it.each([undefined, '', 'false', '1', 'TRUE', 'True', ' true '])('stays disabled for %s', value => {
        vi.stubEnv('CADDY_UI_HYBRID', value);
        expect(hybridEnabled()).toBe(false);
        const next = vi.fn();
        hybridGuard({ method: 'POST', path: '/tls/cert' }, {}, next);
        expect(next).toHaveBeenCalledOnce();
    });

    it('requires the exact opt-in value true', () => {
        vi.stubEnv('CADDY_UI_HYBRID', 'true');
        expect(hybridEnabled()).toBe(true);
    });
});

describe('hybrid ownership and safe rendering', () => {
    it('reserves stopped container labels, numbered labels, wildcard names and normalizes schemes', () => {
        const hosts = labelHosts([{ State: 'exited', Labels: { caddy: 'https://one.example.com, two.example.com', caddy_1: '*.example.net', 'caddy.tls': 'internal' } }]);
        expect(collides('one.example.com', hosts)).toBe(true);
        expect(collides('x.example.net', hosts)).toBe(true);
        expect(collides('x.y.example.net', hosts)).toBe(false);
        expect(hosts.has('internal')).toBe(false);
    });
    it.each(['x.com\n}\nadmin off', '*.example.com', 'https://x.com', 'x.com:443', '-x.com'])('rejects injected or ambiguous hostname %s', domain => {
        expect(() => validateSite({ domain, upstream: 'web:80' })).toThrow();
    });
    it.each(['web:80\nrespond hacked', 'web:0', 'web:65536', 'http://web:80', 'web:80 {'])('rejects unsafe upstream %s', upstream => {
        expect(() => validateSite({ domain: 'x.example.com', upstream })).toThrow();
    });
    it('does not accept certificate path traversal', () => {
        expect(() => validateSite({ domain: 'x.example.com', upstream: 'web:80', certificate: '../../secret' })).toThrow();
    });
    it('renders manual file only, suppressing label conflicts', () => {
        const text = renderState({ revision: 'abc', sites: [{ domain: 'one.example.com', upstream: 'one:80' }, { domain: 'two.example.com', upstream: 'two:80' }] }, new Set(['one.example.com']));
        expect(text).not.toContain('one.example.com {');
        expect(text).toContain('two.example.com {');
        expect(text).toContain('vars ui_revision abc');
    });
    it('blocks every legacy configuration write in hybrid mode', () => {
        vi.stubEnv('CADDY_UI_HYBRID', 'true');
        for (const path of ['/routes', '/caddyfile/reloads', '/metrics/config', '/logs/config', '/tls/cert']) {
            let code;
            const res = { status(c) { code = c; return this; }, json() {} };
            hybridGuard({ method: 'POST', path }, res, () => { throw new Error('write escaped guard'); });
            expect(code).toBe(409);
        }
    });
    it('continues serial writes after failure', async () => {
        await expect(serial(() => { throw new Error('failure'); })).rejects.toThrow();
        expect(await serial(() => 42)).toBe(42);
    });
    it('rejects invalid PEM without saving', () => expect(() => certificatePair('bad', 'bad')).toThrow());
});

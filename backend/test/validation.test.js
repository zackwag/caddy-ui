import { describe, expect, it } from 'vitest';
import { normalizeAdminUrl } from '../src/instances.js';
import { validateUrl } from '../src/validation.js';

describe('validateUrl', () => {
    it('drops the trailing slash URL parsing adds to a bare origin', () => {
        expect(validateUrl('http://caddy:2019')).toBe('http://caddy:2019');
        expect(validateUrl('http://caddy:2019/')).toBe('http://caddy:2019');
    });

    it('keeps a path prefix without its trailing slash', () => {
        expect(validateUrl('https://proxy.example.com/caddy/')).toBe('https://proxy.example.com/caddy');
    });

    it('rejects non-http URLs and garbage', () => {
        expect(() => validateUrl('ftp://caddy:2019')).toThrow('http or https');
        expect(() => validateUrl('not a url')).toThrow('Invalid URL');
    });
});

describe('normalizeAdminUrl', () => {
    it('drops trailing slashes from stored admin URLs', () => {
        expect(normalizeAdminUrl('http://caddy:2019/')).toBe('http://caddy:2019');
        expect(normalizeAdminUrl('http://caddy:2019//')).toBe('http://caddy:2019');
        expect(normalizeAdminUrl('http://caddy:2019')).toBe('http://caddy:2019');
    });

    it('leaves non-strings alone', () => {
        expect(normalizeAdminUrl(undefined)).toBeUndefined();
    });
});

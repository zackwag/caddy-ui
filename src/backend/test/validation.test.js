import { describe, expect, it } from 'vitest';
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

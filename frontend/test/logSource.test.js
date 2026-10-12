import { describe, expect, it } from 'vitest';
import { resolveLogSource } from '../src/utils/logSource.js';

describe('log source links', () => {
    it.each([
        ['', 'caddy'],
        ['?dist=caddy', 'caddy'],
        ['?dist=caddyui', 'app'],
        ['?other=value&dist=caddyui', 'app'],
        ['?dist=', 'caddy'],
        ['?dist=unknown', 'caddy'],
        ['?dist=app', 'caddy'],
    ])('selects the expected source for %s', (search, expected) => {
        expect(resolveLogSource(search)).toBe(expected);
    });

    it.each(['', '?dist=caddy', '?dist=caddyui', '?dist=unknown'])(
        'keeps application logs available without instances for %s',
        search => {
            expect(resolveLogSource(search, true)).toBe('app');
        },
    );
});

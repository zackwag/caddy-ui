import { describe, expect, it } from 'vitest';
import { resolveLogSource } from '../src/utils/logSource.js';

describe('log source links', () => {
    it.each([
        ['', 'caddy'],
        ['?dist=caddy', 'caddy'],
        ['?dist=app', 'app'],
        ['?other=value&dist=app', 'app'],
        ['?dist=', 'caddy'],
        ['?dist=unknown', 'caddy'],
        ['?dist=caddyui', 'caddy'],
    ])('selects the expected source for %s', (search, expected) => {
        expect(resolveLogSource(search)).toBe(expected);
    });

    it.each(['', '?dist=caddy', '?dist=app', '?dist=unknown'])(
        'keeps application logs available without instances for %s',
        search => {
            expect(resolveLogSource(search, true)).toBe('app');
        },
    );
});

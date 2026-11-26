import { describe, expect, it } from 'vitest';
import { parseCaddyfileTitles } from '../src/caddyfileTitles.js';

const env = { APP_DOMAIN: 'app.example.com' };

describe('parseCaddyfileTitles', () => {
    it('reads the first comment of each site block', () => {
        const caddyfile = '{\n\t# not a site\n}\n\n{$APP_DOMAIN} {\n\t# App\n\t# second comment\n\trespond "ok"\n}\n\nplain.example.com {\n\trespond "ok"\n\t# too late\n}\n';
        expect(parseCaddyfileTitles(caddyfile, env)).toEqual({ 'app.example.com': 'App' });
    });

    it('keeps literal braces and heredoc contents out of block boundaries', () => {
        const caddyfile = 'first.example.com {\n\t# First\n\trespond <<BODY\n}\nfake.example.com {\n# Fake\nBODY\n}\n\nsecond.example.com {\n\t# Second\n\trespond "}"\n}\n\nthird.example.com {\n\t# Third\n}\n';
        expect(parseCaddyfileTitles(caddyfile, env)).toEqual({
            'first.example.com': 'First', 'second.example.com': 'Second', 'third.example.com': 'Third',
        });
    });
});

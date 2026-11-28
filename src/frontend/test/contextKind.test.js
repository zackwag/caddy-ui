import { describe, expect, it } from 'vitest';
import { contextKind, scanCaddyfile } from '../src/utils/caddyfileStructure.js';

function kindAt(text, marker) {
    const pos = text.indexOf(marker);
    if (pos === -1) {
        throw new Error(`Marker "${marker}" not found in text`);
    }
    const clean = text.slice(0, pos) + text.slice(pos + marker.length);
    return contextKind(scanCaddyfile(clean), clean, pos);
}

describe('contextKind', () => {
    it('returns none outside any block in the full editor', () => {
        expect(kindAt('|example.com {\n}', '|')).toBe('none');
    });

    it('returns global inside the global options block', () => {
        const text = '{\n\t|email admin@example.com\n}\nexample.com {\n}';
        expect(kindAt(text, '|')).toBe('global');
    });

    it('returns directive inside a site block', () => {
        const text = '{\n\temail admin@example.com\n}\nexample.com {\n\t|\n}';
        expect(kindAt(text, '|')).toBe('directive');
    });

    it('returns subdirective inside a directive block', () => {
        const text = 'example.com {\n\treverse_proxy {\n\t\t|\n\t}\n}';
        expect(kindAt(text, '|')).toBe('subdirective');
    });

    it.each(['handle', 'handle_path /api/*', 'route', 'handle_errors'])('returns directive inside %s', directive => {
        expect(kindAt(`example.com {\n\t${directive} {\n\t\t|\n\t}\n}`, '|')).toBe('directive');
    });

    it('returns none for an empty document in the full editor', () => {
        expect(contextKind(scanCaddyfile(''), '', 0)).toBe('none');
    });
});

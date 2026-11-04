import { describe, expect, it } from 'vitest';
import { contextKind, scanCaddyfile } from '../src/utils/caddyfileStructure.js';

function kindAt(text, marker, siteBlock = false) {
    const pos = text.indexOf(marker);
    if (pos === -1) {
        throw new Error(`Marker "${marker}" not found in text`);
    }
    const clean = text.slice(0, pos) + text.slice(pos + marker.length);
    return contextKind(scanCaddyfile(clean), clean, pos, siteBlock);
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

    it('returns directive inside a handle block', () => {
        const text = 'example.com {\n\thandle {\n\t\t|\n\t}\n}';
        expect(kindAt(text, '|')).toBe('directive');
    });

    it('returns directive inside handle_path', () => {
        const text = 'example.com {\n\thandle_path /api/* {\n\t\t|\n\t}\n}';
        expect(kindAt(text, '|')).toBe('directive');
    });

    it('returns directive inside route', () => {
        const text = 'example.com {\n\troute {\n\t\t|\n\t}\n}';
        expect(kindAt(text, '|')).toBe('directive');
    });

    it('returns directive inside handle_errors', () => {
        const text = 'example.com {\n\thandle_errors {\n\t\t|\n\t}\n}';
        expect(kindAt(text, '|')).toBe('directive');
    });

    it('returns directive at top level of a site-block editor', () => {
        const text = '\t|\n';
        expect(kindAt(text, '|', true)).toBe('directive');
    });

    it('returns subdirective inside a directive in a site-block editor', () => {
        const text = 'reverse_proxy {\n\t|\n}';
        expect(kindAt(text, '|', true)).toBe('subdirective');
    });

    it('returns directive inside handle in a site-block editor', () => {
        const text = 'handle {\n\t|\n}';
        expect(kindAt(text, '|', true)).toBe('directive');
    });

    it('returns global when the first block is braces-only', () => {
        const text = '{\n\t|\n}';
        expect(kindAt(text, '|', false)).toBe('global');
    });

    it('returns none for an empty document in the full editor', () => {
        expect(contextKind(scanCaddyfile(''), '', 0, false)).toBe('none');
    });
});

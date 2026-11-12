import { describe, expect, it } from 'vitest';
import { SNIPPET_CATEGORIES, snippetsForContext } from '../src/utils/caddyfileSnippets.js';

describe('snippetsForContext', () => {
    it('returns site block snippets for the top level', () => {
        const cats = snippetsForContext('none');
        expect(cats).toHaveLength(1);
        expect(cats[0].key).toBe('siteBlocks');
    });

    it('returns directive snippets inside a site block', () => {
        const cats = snippetsForContext('directive');
        expect(cats).toHaveLength(1);
        expect(cats[0].key).toBe('directives');
    });

    it('returns global option snippets inside the global block', () => {
        const cats = snippetsForContext('global');
        expect(cats).toHaveLength(1);
        expect(cats[0].key).toBe('globalOptions');
    });

    it('returns nothing for subdirective context', () => {
        expect(snippetsForContext('subdirective')).toHaveLength(0);
    });
});

describe('snippet templates', () => {
    it('every snippet has a non-empty template', () => {
        for (const cat of SNIPPET_CATEGORIES) {
            for (const snippet of cat.snippets) {
                expect(snippet.template, `${cat.key}.${snippet.key}`).toBeTruthy();
            }
        }
    });

    it('every snippet has a unique key within its category', () => {
        for (const cat of SNIPPET_CATEGORIES) {
            const keys = cat.snippets.map(s => s.key);
            expect(new Set(keys).size, cat.key).toBe(keys.length);
        }
    });
});

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

    it('directive snippets start with the same keyword in both templates', () => {
        for (const cat of SNIPPET_CATEGORIES) {
            // Site blocks start with a tab-stop domain, not a directive keyword
            if (cat.context === 'none') continue;
            for (const snippet of cat.snippets) {
                if (!snippet.snippetTemplate) continue;
                const plainWord = snippet.template.split(/[\s\n{]/)[0];
                const snippetWord = snippet.snippetTemplate.split(/[\s\n{]/)[0];
                expect(snippetWord, `${cat.key}.${snippet.key}`).toBe(plainWord);
            }
        }
    });

    it('snippet templates contain at least one tab stop', () => {
        for (const cat of SNIPPET_CATEGORIES) {
            for (const snippet of cat.snippets) {
                if (snippet.snippetTemplate) {
                    expect(snippet.snippetTemplate, `${cat.key}.${snippet.key}`).toMatch(/#\{/);
                }
            }
        }
    });
});

import { describe, expect, it } from 'vitest';
import { SNIPPET_CATEGORIES, snippetsForContext, snippetText } from '../src/utils/caddyfileSnippets.js';

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
    it('every snippet has a unique key within its category', () => {
        for (const cat of SNIPPET_CATEGORIES) {
            const keys = cat.snippets.map(s => s.key);
            expect(new Set(keys).size, cat.key).toBe(keys.length);
        }
    });

    it('directive snippets start with the same keyword as their menu text', () => {
        for (const { key, context, snippets } of SNIPPET_CATEGORIES) {
            // Site blocks start with a tab-stop domain, not a directive keyword
            if (context === 'none') continue;
            for (const snippet of snippets) {
                const [keyword] = snippetText(snippet).split(/[\s\n{]/);
                expect(snippet.template.startsWith(keyword), `${key}.${snippet.key}`).toBe(true);
            }
        }
    });

    it('snippet templates contain at least one tab stop, which menu text never shows', () => {
        for (const { key, snippets } of SNIPPET_CATEGORIES) {
            for (const snippet of snippets) {
                expect(snippet.template, `${key}.${snippet.key}`).toMatch(/#\{/);
                expect(snippetText(snippet), `${key}.${snippet.key}`).not.toMatch(/#\{/);
            }
        }
    });

    it('menu text fills in placeholders and leaves empty stops blank', () => {
        expect(snippetText({ template: 'handle_path #{1:/prefix/*} {\n\t#{2}\n}' })).toBe('handle_path /prefix/* {\n\t\n}');
        expect(snippetText({ template: 'tls #{1:me@example.com}', text: 'tls internal' })).toBe('tls internal');
    });
});

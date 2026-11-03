import { describe, expect, it } from 'vitest';
import { blockClosedAt, blockOpenedBefore, isLiteralAt, scanCaddyfile } from '../src/utils/caddyfileStructure.js';

// The [open, close] text offsets of each block, as line:column pairs, for readable expectations.
function blocksOf(text) {
    const at = offset => {
        if (offset === null) {
            return null;
        }
        const before = text.slice(0, offset).split('\n');
        return `${before.length}:${before.at(-1).length}`;
    };
    return scanCaddyfile(text).blocks.map(({ open, close }) => [at(open), at(close)]);
}

const lineOf = (text, pos) => {
    const from = text.lastIndexOf('\n', pos - 1) + 1;
    const end = text.indexOf('\n', pos);
    return { from, text: text.slice(from, end === -1 ? text.length : end) };
};

describe('Caddyfile structure', () => {
    it('matches global, site, snippet, matcher and nested directive blocks', () => {
        const text = [
            '{', '\temail admin@example.com', '}',
            '(common) {', '\tencode gzip', '}',
            'example.com, {$EXTRA_SITE} {',
            '\t@api {', '\t\tpath /api/*', '\t}',
            '\thandle @api {', '\t\treverse_proxy {', '\t\t\tto app:3000', '\t\t}', '\t}',
            '}',
        ].join('\n');
        expect(blocksOf(text)).toEqual([
            ['1:0', '3:0'], ['4:9', '6:0'], ['7:27', '16:0'], ['8:6', '10:1'], ['11:13', '15:1'], ['12:16', '14:2'],
        ]);
    });

    it.each([
        ['placeholders', 'site {\n\trespond {host} {path}\n}'],
        ['environment references', 'site {\n\trespond {$GREETING}\n}'],
        ['escaped braces', 'site {\n\trespond \\{ \\}\n}'],
        ['braces inside a token', 'site {\n\trespond a{b}c{\n}'],
        ['a comment', 'site { # opens {\n\t# } closes nothing\n}'],
        ['a double-quoted token', 'site {\n\trespond "{ \\" }"\n}'],
        ['a multi-line quoted token', 'site {\n\trespond "{\n}"\n}'],
        ['a backtick token', 'site {\n\trespond `{ "x" }`\n}'],
        ['a heredoc', 'site {\n\trespond <<HTML\n\t\t<p>{</p>\n\t\t}\n\t\tHTML 200\n}'],
    ])('does not let %s open or close blocks', (label, text) => {
        expect(blocksOf(text)).toEqual([['1:5', `${text.split('\n').length}:0`]]);
    });

    it('counts a `{}` typed together as an empty block', () => {
        expect(blocksOf('site {}\nother {\n}')).toEqual([['1:5', '1:6'], ['2:6', '3:0']]);
    });

    it('treats # inside a token as text, not a comment', () => {
        expect(blocksOf('site {\n\theader X-Tag a#b {\n\t}\n}')).toEqual([['1:5', '4:0'], ['2:18', '3:1']]);
    });

    it('tolerates unfinished input', () => {
        expect(blocksOf('site {\n\thandle {\n')).toEqual([['1:5', null], ['2:8', null]]);
        expect(blocksOf('}\nsite {\n}\n}')).toEqual([['2:5', '3:0']]);
        expect(blocksOf('site {\n\trespond "unterminated {\n}')).toEqual([['1:5', null]]);
        expect(blocksOf('site {\n\trespond <<EOF\n\t{\n}')).toEqual([['1:5', null]]);
        expect(blocksOf('site {\n\trespond <<EOF\n\tEOFX {\n}')).toEqual([['1:5', null]]);
        expect(blocksOf('site {\n\trespond <<\n}')).toEqual([['1:5', '3:0']]);
        expect(scanCaddyfile('')).toEqual({ blocks: [], literals: [] });
    });

    it('finds literal positions where typed brackets stay text', () => {
        const text = 'site { # note\n\trespond "a" `b` <<EOF\n{\nEOF\n}';
        const structure = scanCaddyfile(text);
        const at = needle => text.indexOf(needle);
        expect(isLiteralAt(structure, at('# note') + 1)).toBe(true);
        expect(isLiteralAt(structure, at('# note') + '# note'.length)).toBe(true);
        expect(isLiteralAt(structure, at('"a"') + 1)).toBe(true);
        expect(isLiteralAt(structure, at('"a"') + 3)).toBe(false);
        expect(isLiteralAt(structure, at('`b`') + 2)).toBe(true);
        expect(isLiteralAt(structure, at('{\nEOF'))).toBe(true);
        expect(isLiteralAt(structure, at('# note'))).toBe(false);
        expect(isLiteralAt(structure, text.length - 1)).toBe(false);
        expect(isLiteralAt(scanCaddyfile('respond "open'), 'respond "open'.length)).toBe(true);
    });

    it('finds the block a new line would open, and the block a brace closes', () => {
        const text = 'site { # note\n\thandle {}\n\trespond {host}\n}';
        const structure = scanCaddyfile(text);
        const opened = pos => blockOpenedBefore(structure, lineOf(text, pos), pos);
        expect(opened(text.indexOf(' # note'))).toBe(structure.blocks[0]);
        expect(opened(text.indexOf('\n'))).toBe(structure.blocks[0]);
        expect(opened(text.indexOf('{}') + 1)).toBe(structure.blocks[1]);
        expect(opened(text.indexOf('{}') + 2)).toBe(null);
        expect(opened(text.indexOf('{host}') + 1)).toBe(null);
        expect(opened(text.indexOf('\trespond'))).toBe(null);
        expect(blockClosedAt(structure, text.indexOf('}'))).toBe(structure.blocks[1]);
        expect(blockClosedAt(structure, text.lastIndexOf('}'))).toBe(structure.blocks[0]);
        expect(blockClosedAt(structure, text.indexOf('{host}') + 5)).toBe(null);
    });
});

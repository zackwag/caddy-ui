import { describe, expect, it } from 'vitest';
import { caddyfileChildren, extractDirective, extractGlobalBlock, scanCaddyfile } from '../src/caddyfileBlocks.js';

describe('Caddyfile structural scanning', () => {
    it.each([
        ['comment', '# log { }\n'],
        ['double quotes', '"literal \\" } {"'],
        ['backticks', '`literal } {`'],
        ['runtime placeholder', '{env.EXAMPLE}'],
        ['environment substitution', '{$EXAMPLE}'],
        ['URL fragment', 'https://example.test/#fragment'],
        ['heredoc', '<<BODY\n{\nlog {\n}\nBODY'],
    ])('keeps %s out of structural brace counting', (_name, literal) => {
        const source = `{ # global {\n storage file_system {\n root ${literal}\n }\n}\n`;
        expect(extractGlobalBlock(source).text).toBe(source.trimEnd());
    });

    it('recognizes comments only at token boundaries', () => {
        const tokens = scanCaddyfile('value#fragment # ignored {\n');
        expect(tokens.map(token => token.value)).toEqual(['value#fragment', '\n']);
    });

    it('keeps escaped newlines in the same directive header', () => {
        const children = caddyfileChildren('output \\\n file /tmp/example.log {\n roll_keep 5\n}\n');
        expect(children).toHaveLength(1);
        expect(children[0].args).toEqual(['file', '/tmp/example.log']);
    });

    it('ignores a brace at column zero inside a site heredoc', () => {
        expect(extractGlobalBlock(':8080 {\n respond <<BODY\n{\n}\nBODY\n}\n')).toBeNull();
    });

    it('finds a global block after a snippet without editing the snippet', () => {
        const source = '(common) {\n respond "OK"\n}\n{\n admin off\n}\n:8080 {\n import common\n}';
        expect(extractGlobalBlock(source).text).toBe('{\n admin off\n}');
    });

    it('skips a leading BOM, comments and blank lines', () => {
        expect(extractGlobalBlock('\ufeff# header\r\n\r\n{ # options\r\n admin off\r\n}\r\n').inner).toContain('admin off');
    });

    it('ends tokens before a CRLF so offsets stay on the token', () => {
        const source = '{\r\n\tadmin off\r\n}\r\n';
        const tokens = scanCaddyfile(source);
        expect(tokens.map(token => source.slice(token.start, token.end))).toEqual(['{', '\n', 'admin', 'off', '\n', '}', '\n']);
        expect(extractGlobalBlock(source).inner).toBe('\r\n\tadmin off\r\n');
    });

    it('recognizes CRLF heredocs without counting literal braces as structure', () => {
        const source = ':8080 {\r\n respond <<BODY\r\n{\r\nlog {\r\n}\r\nBODY\r\n}\r\n';
        expect(extractGlobalBlock(source)).toBeNull();
        const literal = scanCaddyfile(source).find(token => token.value.startsWith('{\nlog'));
        expect(literal.kind).toBe('word');
        expect(source.slice(literal.start, literal.end)).toBe('<<BODY\r\n{\r\nlog {\r\n}\r\nBODY');
    });

    it('selects only direct children using a caller-owned predicate', () => {
        const nested = 'custom {\n handler {\n output stderr\n }\n}\nhandler other {\n output stderr\n}\n';
        expect(extractDirective(nested, 'handler')).toBeNull();
        const chosen = extractDirective(nested + 'handler chosen {\n output file /tmp/a {\n option value\n }\n}', 'handler', child => child.args[0] === 'chosen');
        expect(chosen.inner).toContain('option value');
        expect(chosen.fullMatch).toContain('handler chosen');
    });

    it('returns a directive without a block and preserves its source offsets', () => {
        const source = '\toption value # keep\r\n';
        const child = extractDirective(source, 'option', child => child.args[0] === 'value');
        expect(child.inner).toBe('');
        expect(child.block).toBeNull();
        expect(source.slice(child.start, child.end)).toBe('\toption value');
    });

    it.each(['{\n admin off', '{\n value "unclosed', '{\n value <<BODY\n unclosed'])('rejects incomplete input instead of inventing boundaries', source => {
        expect(() => extractGlobalBlock(source)).toThrow(SyntaxError);
    });

    it('rejects ambiguous directives without embedding caller policy', () => {
        expect(() => extractDirective('option\noption {\n}', 'option')).toThrow('Multiple option directives');
    });
});

import { describe, expect, it } from 'vitest';
import { caddyfileChildren, extractDirectiveBlock, extractGlobalBlock, scanCaddyfile } from '../src/caddyfileBlocks.js';

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

    it('finds only the direct-child default logger', () => {
        const nested = 'custom {\n log {\n output stderr\n }\n}\nlog audit {\n output stderr\n}\n';
        expect(extractDirectiveBlock(nested, 'log')).toBeNull();
        expect(extractDirectiveBlock(nested + 'log default {\n output stdout\n}', 'log').inner).toContain('output stdout');
    });

    it.each(['{\n admin off', '{\n value "unclosed', '{\n value <<BODY\n unclosed'])('rejects incomplete input instead of inventing boundaries', source => {
        expect(() => extractGlobalBlock(source)).toThrow(SyntaxError);
    });

    it('rejects ambiguous default loggers', () => {
        expect(() => extractDirectiveBlock('log {\n}\nlog default {\n}', 'log')).toThrow('Multiple default log blocks');
    });
});

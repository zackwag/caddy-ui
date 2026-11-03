import { history, undo } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { indentation, insertIndentation, insertNewlinePreservingIndent, removeIndentation } from '../src/utils/caddyfileIndentation.js';

// `|` marks a caret; `[` and `]` mark a selection's anchor and head.
function stateOf(marked, extensions = []) {
    const ranges = [];
    let doc = '';
    let anchor = null;
    for (const char of marked) {
        if (char === '|') {
            ranges.push(EditorSelection.cursor(doc.length));
        } else if (char === '[') {
            anchor = doc.length;
        } else if (char === ']') {
            ranges.push(EditorSelection.range(anchor, doc.length));
        } else {
            doc += char;
        }
    }
    return EditorState.create({ doc, selection: EditorSelection.create(ranges), extensions: [indentation, ...extensions] });
}

function run(command, state) {
    let next = state;
    const handled = command({ state, dispatch: transaction => { next = transaction.state; } });
    return { handled, state: next, text: next.doc.toString() };
}

describe('Caddyfile editor indentation', () => {
    it('inserts a literal tab at a caret, without touching the rest of the line', () => {
        const { handled, state, text } = run(insertIndentation, stateOf('example.com {\n\treverse_proxy| app:3000\n}'));
        expect(handled).toBe(true);
        expect(text).toBe('example.com {\n\treverse_proxy\t app:3000\n}');
        expect(state.selection.main.head).toBe('example.com {\n\treverse_proxy'.length + 1);
    });

    it('indents selected lines by one level, keeping existing tabs and spaces', () => {
        const { text, state } = run(insertIndentation, stateOf('[a {\n\tb\n  c]\n}'));
        expect(text).toBe('\ta {\n\t\tb\n\t  c\n}');
        expect(state.selection.main.empty).toBe(false);
    });

    it('does not indent a line the selection only reaches at its start', () => {
        expect(run(insertIndentation, stateOf('[a\nb\n]c')).text).toBe('\ta\n\tb\nc');
    });

    it('outdents selected lines by one level and leaves unindented lines alone', () => {
        expect(run(removeIndentation, stateOf('[        a\n    b\nc]')).text).toBe('    a\nb\nc');
        const { handled, state, text } = run(removeIndentation, stateOf('c|'));
        expect(handled).toBe(true);
        expect(text).toBe('c');
        expect(state.selection.main.head).toBe(1);
    });

    it.each([
        ['one level of spaces before a tab', '    \tb|', '\tb'],
        ['a tab before spaces', '\t    b|', '    b'],
        ['less than a level', '  b|', 'b'],
        ['spaces then a tab that completes the level', '  \tb|', 'b'],
    ])('outdents by removing %s, without converting what remains', (label, before, after) => {
        expect(run(removeIndentation, stateOf(before)).text).toBe(after);
    });

    it.each([2, 4, 8])('outdents one tab-width level at %i columns, rather than one character', width => {
        const state = stateOf(' '.repeat(width) + 'value|', [EditorState.tabSize.of(width)]);
        expect(run(removeIndentation, state).text).toBe('value');
        expect(run(removeIndentation, stateOf('\t\tvalue|', [EditorState.tabSize.of(width)])).text).toBe('\tvalue');
    });

    it('outdents from any caret position on the line, and Tab then Shift+Tab gives back the line', () => {
        expect(run(removeIndentation, stateOf('\t\treverse_proxy| app')).text).toBe('\treverse_proxy app');
        const indented = run(insertIndentation, stateOf('[a {\n\tb\n]}')).state;
        expect(run(removeIndentation, indented).text).toBe('a {\n\tb\n}');
    });

    it.each([
        ['spaces', '    reverse_proxy app:3000|', '    reverse_proxy app:3000\n    |'],
        ['a tab', '\treverse_proxy app:3000|', '\treverse_proxy app:3000\n\t|'],
        ['mixed whitespace', '\t  respond ok|', '\t  respond ok\n\t  |'],
        ['no indentation', 'example.com|', 'example.com\n|'],
    ])('starts a new line with the same %s as the line it splits', (label, before, after) => {
        const { state, text } = run(insertNewlinePreservingIndent, stateOf(before));
        const caret = state.selection.main.head;
        expect(text.slice(0, caret) + '|' + text.slice(caret)).toBe(after);
    });

    it.each([
        ['moves text after the caret down without its leading spaces', '\tlog| output', '\tlog\n\t|output'],
        ['opens a line above from a caret inside the indentation', '\t|\tfoo', '\n\t|\tfoo'],
        ['opens a line above from the end of the indentation', '    |foo', '\n    |foo'],
        ['replaces a selection, indenting from where it starts', '\treverse_proxy [app:3000]', '\treverse_proxy\n\t|'],
        ['keeps a whitespace-only line\'s indentation on the caret line', '    |', '\n    |'],
        ['does not leave trailing whitespace when a selection starts in the indentation', '  [foo]', '\n  |'],
    ])('%s', (label, before, after) => {
        const { state, text } = run(insertNewlinePreservingIndent, stateOf(before));
        const caret = state.selection.main.head;
        expect(text.slice(0, caret) + '|' + text.slice(caret)).toBe(after);
    });

    it('leaves the rest of the document untouched', () => {
        expect(run(insertNewlinePreservingIndent, stateOf('a {\n\tb|\n  c\n}')).text).toBe('a {\n\tb\n\t\n  c\n}');
    });

    it.each([
        ['opens an empty pair into an indented body and an aligned closing line', 'example.com {|}', 'example.com {\n\t|\n}'],
        ['does the same with spaces between the braces', 'example.com { | }', 'example.com {\n\t|\n}'],
        ['aligns a nested pair with its own opening line', 'a {\n\thandle {|}\n}', 'a {\n\thandle {\n\t\t|\n\t}\n}'],
        ['indents one level after an opening brace', 'example.com {|\n}', 'example.com {\n\t|\n}'],
        ['indents after an opening brace followed by a comment', '\t@api { # matcher|\n\t}', '\t@api { # matcher\n\t\t|\n\t}'],
        ['preserves an existing space prefix and adds only a tab for a new level', '  route {\n    handle {|', '  route {\n    handle {\n    \t|'],
        ['aligns a closing brace moved to a new line with its opening line', '\ta {\n\t\tb |}', '\ta {\n\t\tb\n\t|}'],
        ['keeps a placeholder from counting as a block', '\trespond {host}|', '\trespond {host}\n\t|'],
        ['keeps a brace in a comment from counting as a block', '\t# note {|', '\t# note {\n\t|'],
        ['keeps a brace in a quoted token from counting as a block', '\trespond "{|', '\trespond "{\n\t|'],
        ['keeps an escaped brace from counting as a block', '\trespond \\{|', '\trespond \\{\n\t|'],
        ['tolerates an unmatched closing brace', '}\n}|', '}\n}\n|'],
    ])('%s', (label, before, after) => {
        const { state, text } = run(insertNewlinePreservingIndent, stateOf(before));
        const caret = state.selection.main.head;
        expect(text.slice(0, caret) + '|' + text.slice(caret)).toBe(after);
    });

    it('undoes an opened pair in one step', () => {
        const opened = run(insertNewlinePreservingIndent, stateOf('a {|}', [history()])).state;
        expect(run(undo, opened).text).toBe('a {}');
    });

    it('is undone as a single step', () => {
        const indented = run(insertIndentation, stateOf('a|', [history()])).state;
        expect(run(undo, indented).text).toBe('a');
    });

    it('does nothing in a read-only editor', () => {
        const readOnly = stateOf('a|', [EditorState.readOnly.of(true)]);
        expect(run(insertIndentation, readOnly)).toMatchObject({ handled: false, text: 'a' });
    });
});

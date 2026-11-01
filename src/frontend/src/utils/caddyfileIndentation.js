import { indentMore } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { EditorSelection } from '@codemirror/state';
import { blockClosedAt, blockOpenedBefore, scanCaddyfile } from './caddyfileStructure.js';

// New indentation is four spaces per level. Existing indentation is never
// converted: `caddy fmt` writes tabs, and only the lines being edited change.
export const INDENT = '    ';

// Documents are immutable, so each version is scanned at most once.
const structures = new WeakMap();
export function structureOf(doc) {
    let structure = structures.get(doc);
    if (!structure) {
        structure = scanCaddyfile(doc.toString());
        structures.set(doc, structure);
    }
    return structure;
}

// Tab at a caret inserts one level of spaces there. With text selected it
// indents every selected line instead, using CodeMirror's own command, which
// skips a line the selection only touches at its start.
export function insertIndentation({ state, dispatch }) {
    if (state.readOnly) {
        return false;
    }
    if (state.selection.ranges.some(range => !range.empty)) {
        return indentMore({ state, dispatch });
    }
    // eslint-disable-next-line i18next/no-literal-string -- CodeMirror user event name, not UI copy
    dispatch(state.update(state.replaceSelection(state.facet(indentUnit)), { scrollIntoView: true, userEvent: 'input' }));
    return true;
}

// The lines a selection covers, once each. A non-empty range that ends at the
// start of a line doesn't include that line, matching CodeMirror's commands.
function selectedLines(state) {
    const lines = new Map();
    for (const range of state.selection.ranges) {
        const last = state.doc.lineAt(range.to);
        const end = !range.empty && range.to === last.from && last.number > 1 ? last.number - 1 : last.number;
        for (let number = state.doc.lineAt(range.from).number; number <= end; number++) {
            lines.set(number, state.doc.line(number));
        }
    }
    return [...lines.values()];
}

// Shift+Tab removes one level (one indent unit's width of columns) from the
// start of each selected line by deleting leading whitespace characters,
// rather than rebuilding the indentation from columns as CodeMirror's
// indentLess does. A tab left after the removed spaces stays a tab, so Tab
// then Shift+Tab gives back the original line. Unindented lines are left alone.
export function removeIndentation({ state, dispatch }) {
    if (state.readOnly) {
        return false;
    }
    const width = state.facet(indentUnit).length;
    const changes = [];
    for (const line of selectedLines(state)) {
        let column = 0;
        let length = 0;
        while (column < width && length < line.length && /[ \t]/.test(line.text[length])) {
            column = line.text[length] === '\t' ? column + state.tabSize - (column % state.tabSize) : column + 1;
            length++;
        }
        if (length) {
            changes.push({ from: line.from, to: line.from + length });
        }
    }
    if (changes.length) {
        // eslint-disable-next-line i18next/no-literal-string -- CodeMirror user event name, not UI copy
        dispatch(state.update({ changes }, { scrollIntoView: true, userEvent: 'delete.dedent' }));
    }
    return true;
}

// Enter starts the new line with the same leading whitespace as the line it
// splits, character for character, so a tab-indented line continues with a
// tab. CodeMirror's own newline command rebuilds indentation from columns in
// the indent unit, which would turn those tabs into spaces. Blocks add to that:
// - After a block's `{`, the new line is indented one level (four spaces) more.
// - Between `{` and its `}`, the brace moves to a line of its own, aligned
//   with the opening line, and the caret goes on an indented line between.
// - A `}` moved to a new line aligns with the line that opened its block.
// Otherwise:
// - A caret within the indentation opens a blank line above, leaving its own line as it was.
// - Whitespace around the caret is dropped: the line it splits keeps no
//   trailing spaces, and the moved text starts at the indentation.
export function insertNewlinePreservingIndent({ state, dispatch }) {
    if (state.readOnly) {
        return false;
    }
    const structure = structureOf(state.doc);
    const leading = text => /^[ \t]*/.exec(text)[0];
    dispatch(state.update(state.changeByRange(range => {
        const line = state.doc.lineAt(range.from);
        const before = line.text.slice(0, range.from - line.from);
        if (range.empty && !/\S/.test(before)) {
            return { changes: { from: line.from, insert: state.lineBreak }, range: EditorSelection.cursor(range.from + state.lineBreak.length) };
        }
        const indent = leading(before);
        let from = range.from;
        let to = range.to;
        const end = state.doc.lineAt(to);
        while (to < end.to && /[ \t]/.test(end.text[to - end.from])) {
            to++;
        }
        if (!/\S/.test(before)) {
            from = line.from;
        }
        while (from > line.from && /[ \t]/.test(line.text[from - 1 - line.from])) {
            from--;
        }
        const opened = blockOpenedBefore(structure, line, range.from);
        const closed = end.text[to - end.from] === '}' ? blockClosedAt(structure, to) : null;
        if (opened && opened === closed) {
            const body = state.lineBreak + indent + INDENT;
            return { changes: { from, to, insert: body + state.lineBreak + indent }, range: EditorSelection.cursor(from + body.length) };
        }
        const insert = state.lineBreak + (closed ? leading(state.doc.lineAt(closed.open).text) : opened ? indent + INDENT : indent);
        return { changes: { from, to, insert }, range: EditorSelection.cursor(from + insert.length) };
    // eslint-disable-next-line i18next/no-literal-string -- CodeMirror user event name, not UI copy
    }), { scrollIntoView: true, userEvent: 'input' }));
    return true;
}

// Escape then Tab, or Ctrl-M (Shift-Alt-M on macOS) from the default keymap,
// still moves focus out of the editor: CodeMirror's tab focus mode bypasses
// these bindings.
export const indentationKeymap = [
    // eslint-disable-next-line i18next/no-literal-string -- CodeMirror key name, not UI copy
    { key: 'Tab', run: insertIndentation, shift: removeIndentation },
    // eslint-disable-next-line i18next/no-literal-string -- CodeMirror key name, not UI copy
    { key: 'Enter', run: insertNewlinePreservingIndent, shift: insertNewlinePreservingIndent },
];

export const indentation = [indentUnit.of(INDENT)];

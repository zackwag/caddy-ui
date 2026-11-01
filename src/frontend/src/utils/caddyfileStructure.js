// Block structure of Caddyfile text, following the tokenizer rules of Caddy's
// own lexer closely enough for editing help: indentation, bracket completion
// and folding. It never decides whether a configuration is valid; that stays
// with Caddy. Unfinished input is expected while someone is typing, so an
// unmatched brace or an unterminated quote is recorded, never an error.
//
// - A block opens at an unquoted token that is exactly `{` and closes at one
//   that is exactly `}`. Placeholders (`{host}`), environment references
//   (`{$VAR}`) and escaped braces (`\{`) are longer tokens, so they never
//   open or close blocks.
// - `#` starts a comment only at the start of a token, as in Caddy.
// - "double-quoted" and `backtick` tokens may span lines; a backslash escapes
//   the next character in a double-quoted token.
// - A `<<MARKER` heredoc runs until a line that starts with that marker.
// - `{}` typed together counts as an empty block, as bracket completion inserts it.
// Comments, quoted tokens and heredocs are literal: braces inside them are text.

const SPACE = /[ \t\r\n]/;
const HEREDOC = /^<<([A-Za-z0-9_-]+)[ \t]*\r?$/;

// Returns { blocks, literals }:
// - blocks: { open, close } offsets of each `{` and its matching `}`, in
//   order of `open`. `close` is null for a block that isn't closed yet.
//   A `}` with no open block is ignored.
// - literals: { from, to, closed } ranges of comments, quoted tokens and
//   heredocs, in order. `to` is the offset just past the range. `closed` is
//   false for a comment (it ends with its line) or an unterminated token
//   (it runs to the end of the text).
export function scanCaddyfile(text) {
    const blocks = [];
    const literals = [];
    const open = [];
    let i = 0;
    while (i < text.length) {
        const char = text[i];
        if (SPACE.test(char)) {
            i++;
            continue;
        }
        const start = i;
        if (char === '#') {
            const end = text.indexOf('\n', i);
            i = end === -1 ? text.length : end;
            literals.push({ from: start, to: i, closed: false });
            continue;
        }
        if (char === '"' || char === '`') {
            i++;
            while (i < text.length && text[i] !== char) {
                i += char === '"' && text[i] === '\\' ? 2 : 1;
            }
            const closed = i < text.length;
            i = closed ? i + 1 : text.length;
            literals.push({ from: start, to: i, closed });
            continue;
        }
        if (text.startsWith('<<', i)) {
            const lineEnd = text.indexOf('\n', i);
            const marker = HEREDOC.exec(text.slice(i, lineEnd === -1 ? text.length : lineEnd))?.[1];
            if (marker) {
                // The closing marker is the first token on its line; more
                // tokens may follow it, as in `HTML 200`.
                // The marker matched [A-Za-z0-9_-]+, so it's safe inside a pattern.
                // eslint-disable-next-line i18next/no-literal-string -- Regular expression, not UI copy
                const close = new RegExp(`^([ \\t]*)${marker}(?=[ \\t\\r]|$)`, 'm');
                const rest = lineEnd === -1 ? null : close.exec(text.slice(lineEnd + 1));
                if (!rest) {
                    i = text.length;
                    literals.push({ from: start, to: i, closed: false });
                } else {
                    i = lineEnd + 1 + rest.index + rest[0].length;
                    literals.push({ from: start, to: i, closed: true });
                }
                continue;
            }
        }
        // An unquoted token runs to the next whitespace. A backslash keeps the
        // next character in the token, so `\{` is a token of its own.
        while (i < text.length && !SPACE.test(text[i])) {
            i += text[i] === '\\' && i + 1 < text.length && text[i + 1] !== '\n' ? 2 : 1;
        }
        const token = text.slice(start, i);
        // Bracket completion types `{}` as one token. Caddy reads that as a
        // plain argument, but while editing it's an empty block in the making.
        if (token === '{}') {
            blocks.push({ open: start, close: start + 1 });
        } else if (token === '{') {
            const block = { open: start, close: null };
            blocks.push(block);
            open.push(block);
        } else if (token === '}' && open.length) {
            open.pop().close = start;
        }
    }
    return { blocks, literals };
}

// Whether a caret at `pos` is inside a comment, quoted token or heredoc, where
// typed brackets are text rather than structure. A caret just past a closed
// quote is outside it; a caret at the end of a comment's line is inside.
export function isLiteralAt({ literals }, pos) {
    return literals.some(({ from, to, closed }) => from < pos && (closed ? pos < to : pos <= to));
}

// The block whose `{` ends the code on a line before `pos`, so a new line
// inserted at `pos` belongs inside it. `line` is { from, text } for the line
// holding `pos`. Whitespace or a comment may follow the brace.
export function blockOpenedBefore({ blocks }, line, pos) {
    for (let index = blocks.length - 1; index >= 0; index--) {
        const block = blocks[index];
        if (block.open >= pos) {
            continue;
        }
        if (block.open < line.from) {
            return null;
        }
        const between = line.text.slice(block.open + 1 - line.from, pos - line.from);
        return /^[ \t]*$/.test(between) || /^[ \t]+#.*$/.test(between) ? block : null;
    }
    return null;
}

// The block closed by a `}` at `pos`, or null if there's no closing brace there.
export function blockClosedAt(structure, pos) {
    return structure.blocks.find(block => block.close === pos) ?? null;
}

// The foldable range for a line whose code ends with a block's `{`: from the
// end of that line (keeping a trailing comment visible) to the block's `}`.
// Null when the line opens no block or its block isn't closed yet, so
// unfinished input never folds. `line` is { from, text }.
export function foldRangeOf(structure, line) {
    const end = line.from + line.text.length;
    const block = blockOpenedBefore(structure, line, end);
    if (!block || block.close === null || block.close <= end) {
        return null;
    }
    return { from: end, to: block.close };
}

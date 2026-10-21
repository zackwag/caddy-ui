// Structural scanning only: Caddy remains responsible for imports, environment
// expansion and directive validation. Token boundaries follow Caddy's lexer:
// https://github.com/caddyserver/caddy/blob/v2.10.2/caddyconfig/caddyfile/lexer.go
export function scanCaddyfile(source) {
    const tokens = [];
    let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
    while (i < source.length) {
        const start = i;
        if (source[i] === '\n') {
            tokens.push({ value: '\n', kind: 'newline', start, end: ++i });
            continue;
        }
        if (/\s/.test(source[i])) { i++; continue; }
        if (source[i] === '#') {
            while (i < source.length && source[i] !== '\n') i++;
            continue;
        }
        let value = '';
        let quoted = false;
        if (source[i] === '"' || source[i] === '`') {
            quoted = true;
            const quote = source[i++];
            while (i < source.length && source[i] !== quote) {
                if (quote === '"' && source[i] === '\\' && source[i + 1] === '"') i++;
                else if (quote === '"' && source[i] === '\\' && i + 1 < source.length) {
                    value += source[i++];
                }
                value += source[i++];
            }
            if (i === source.length) throw new SyntaxError('Unclosed Caddyfile string');
            i++;
        } else {
            let escapedHeredoc = false;
            while (i < source.length) {
                // A CRLF ends the token; folding its \r in would shift edit offsets.
                if (source[i] === '\r' && source[i + 1] !== '\n') { i++; continue; }
                if (/\s/.test(source[i])) break;
                if (source[i] === '\\' && /^(?:\r?\n)/.test(source.slice(i + 1, i + 3))) {
                    i += source[i + 1] === '\r' ? 3 : 2;
                    break;
                }
                if (source[i] === '\\' && source[i + 1] === '<') {
                    escapedHeredoc = true;
                    i++;
                }
                value += source[i++];
            }
            const newlineLength = source[i] === '\n' ? 1 : source.slice(i, i + 2) === '\r\n' ? 2 : 0;
            if (!escapedHeredoc && value.startsWith('<<') && newlineLength) {
                const marker = value.slice(2);
                if (!/^[A-Za-z0-9_-]+$/.test(marker)) throw new SyntaxError('Invalid Caddyfile heredoc marker');
                const body = i + newlineLength;
                const closing = source.indexOf(marker, body);
                if (closing === -1) throw new SyntaxError('Unclosed Caddyfile heredoc');
                const line = source.lastIndexOf('\n', closing - 1) + 1;
                const padding = source.slice(line, closing);
                value = source.slice(body, line).split('\n').map(text => text.slice(padding.length)).join('\n').replace(/\r/g, '').replace(/\n$/, '');
                i = closing + marker.length;
                quoted = true;
            }
        }
        if (i === start) throw new SyntaxError('Cannot scan Caddyfile token');
        if (!value && !quoted) continue; // An escaped newline between arguments.
        const kind = !quoted && (value === '{' || value === '}') ? value : 'word';
        tokens.push({ value, kind, start, end: i });
    }
    return tokens;
}

function closingBrace(tokens, opening) {
    let depth = 0;
    for (let i = opening; i < tokens.length; i++) {
        if (tokens[i].kind === '{') depth++;
        if (tokens[i].kind === '}') depth--;
        if (depth === 0) return i;
    }
    throw new SyntaxError('Unclosed Caddyfile block');
}

// Each child owns its header and optional block. Skipping its entire block
// keeps nested directives and literal values out of sibling searches.
export function caddyfileChildren(source) {
    const tokens = scanCaddyfile(source);
    const children = [];
    let i = 0;
    while (i < tokens.length) {
        if (tokens[i].kind === 'newline') { i++; continue; }
        const header = [];
        const start = tokens[i].start;
        while (i < tokens.length && tokens[i].kind === 'word') header.push(tokens[i++]);
        let end = header.at(-1)?.end ?? start;
        let block = null;
        if (tokens[i]?.kind === '{') {
            const open = tokens[i];
            const closing = closingBrace(tokens, i);
            const close = tokens[closing];
            block = { start: open.start, end: close.end, close: close.start, inner: source.slice(open.end, close.start) };
            end = close.end;
            i = closing + 1;
        } else if (tokens[i]?.kind === '}') {
            throw new SyntaxError('Unexpected Caddyfile closing brace');
        }
        children.push({ name: header[0]?.value, args: header.slice(1).map(token => token.value), start, end, block });
    }
    return children;
}

export function extractGlobalBlock(source) {
    // Snippet definitions may precede a global block. Their braces belong to
    // their own child; a heredoc containing "{" never becomes a block token.
    const globals = caddyfileChildren(source).filter(child => !child.name && child.block);
    if (globals.length > 1) throw new SyntaxError('Multiple Caddyfile global blocks');
    const global = globals[0]?.block;
    return global ? { ...global, text: source.slice(global.start, global.end) } : null;
}

export function extractDirective(source, directive, predicate = child => child.args.length === 0) {
    const matches = caddyfileChildren(source).filter(child => child.name === directive && predicate(child));
    if (matches.length > 1) throw new SyntaxError(`Multiple ${directive} directives`);
    const child = matches[0];
    if (!child) return null;
    const line = source.lastIndexOf('\n', child.start - 1) + 1;
    const start = /^\s*$/.test(source.slice(line, child.start)) ? line : child.start;
    return { start, headerStart: child.start, end: child.end, block: child.block, inner: child.block?.inner || '', fullMatch: source.slice(start, child.end) };
}

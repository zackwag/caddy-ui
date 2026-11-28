import { caddyfileChildren, extractGlobalBlock } from './caddyfileBlocks.js';

// Editing one option of a Caddyfile's global block in the file's own style.

function lineIndent(content, offset) {
    const line = content.lastIndexOf('\n', offset - 1) + 1;
    const prefix = content.slice(line, offset);
    return /^[ \t]*$/.test(prefix) ? prefix : null;
}

function indentUnitInBlock(content, block, headerStart, sourceOffset = 0) {
    // Option offsets are relative to the global body; other blocks already use
    // whole-file offsets. Translate them before looking at line indentation.
    const parentIndent = lineIndent(content, sourceOffset + headerStart) ?? '';
    for (const child of caddyfileChildren(block.inner)) {
        const childIndent = lineIndent(content, sourceOffset + block.start + 1 + child.start);
        if (childIndent !== null && childIndent.startsWith(parentIndent)) {
            return childIndent.slice(parentIndent.length);
        }
    }
    return undefined;
}

function indentUnit(content, global, option) {
    // Prefer the option's own block, then the global block, then other top-level
    // blocks in source order. Only structural children supply evidence, so
    // comments and heredoc contents cannot select the indentation style.
    if (option?.block) {
        const unit = indentUnitInBlock(content, option.block, option.headerStart, global.start + 1);
        if (unit !== undefined) {
            return unit;
        }
    }
    if (global) {
        const unit = indentUnitInBlock(content, global, global.start);
        if (unit !== undefined) {
            return unit;
        }
    }
    for (const entry of caddyfileChildren(content)) {
        if (!entry.block) {
            continue;
        }
        const unit = indentUnitInBlock(content, entry.block, entry.start);
        if (unit !== undefined) {
            return unit;
        }
    }
    // An empty string is a valid unindented style. Use tabs only when no block
    // supplied evidence, rather than treating empty indentation as missing.
    return '\t';
}

function lineEnding(content, global, option) {
    let start = 0;
    if (option?.block) {
        start = global.start + 1 + option.block.start;
    } else if (global) {
        start = global.start;
    }
    const newline = content.indexOf('\n', start);
    return newline > 0 && content[newline - 1] === '\r' ? '\r\n' : '\n';
}

function optionStyle(content, global, option) {
    const unit = indentUnit(content, global, option);
    const globalBodyStart = global ? global.start + 1 : 0;
    const ownIndent = option ? lineIndent(content, globalBodyStart + option.headerStart) : null;
    let indent = ownIndent;

    // Keep the option's existing column. If absent or inline, use the first
    // global sibling on its own line, then the global column plus one step.
    if (indent === null && global) {
        for (const child of caddyfileChildren(global.inner)) {
            const siblingIndent = lineIndent(content, globalBodyStart + child.start);
            if (siblingIndent !== null) {
                indent = siblingIndent;
                break;
            }
        }
    }
    if (indent === null) {
        const globalIndent = global ? lineIndent(content, global.start) ?? '' : '';
        indent = globalIndent + unit;
    }

    return {
        indent,
        unit,
        eol: lineEnding(content, global, option),
        // An inline option keeps the prefix already present before its header.
        inline: Boolean(option && ownIndent === null),
    };
}

// Adds, replaces or removes a global option. `find` locates it in the global
// block's body (an extractDirective result, or null when it isn't there);
// `render` returns its text in the given style. A null `render` removes it.
export function setGlobalOption(content, find, render) {
    const global = extractGlobalBlock(content);
    const option = global ? find(global.inner) : null;
    const style = render ? optionStyle(content, global, option) : null;
    const text = render ? render(style) : null;

    if (!global) {
        if (!text) {
            return content;
        }
        const bom = content.startsWith('\ufeff') ? 1 : 0;
        return content.slice(0, bom) + `{${style.eol}${text}${style.eol}}${style.eol}${style.eol}` + content.slice(bom);
    }

    if (option) {
        const start = global.start + 1 + option.start;
        let end = global.start + 1 + option.end;
        // A removed option that owned its whole line takes the line break with
        // it, so repeated removals and additions don't accumulate blank lines.
        const lineBreak = content.slice(end).match(/^[ \t]*\r?\n/);
        if (!text && lineBreak && (start === 0 || content[start - 1] === '\n')) {
            end += lineBreak[0].length;
        }
        return content.slice(0, start) + (text || '') + content.slice(end);
    }
    if (!text) {
        return content;
    }

    const line = content.lastIndexOf('\n', global.close - 1) + 1;
    const start = /^\s*$/.test(content.slice(line, global.close)) ? line : global.close;
    const before = content.slice(0, start);
    const separator = before.endsWith('\n') ? '' : style.eol;
    return before + separator + text + style.eol + content.slice(start);
}

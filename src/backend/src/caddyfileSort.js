import { caddyfileEntries, trailingComments } from './caddyfileBlocks.js';

function parseSiteBlocks(content) {
    const entries = caddyfileEntries(content);
    const blocks = [];
    const loose = [];

    for (const entry of entries) {
        // Comments directly above an entry move with it.
        const lines = [...entry.leading, ...entry.text.split('\n')];
        if (entry.block) {
            blocks.push({ header: content.slice(entry.lineStart, entry.block.start + 1).trim(), lines });
        } else {
            // Top-level line that is not a site block, e.g. `import
            // conf.d/*.caddy`. Keep it verbatim instead of dropping it.
            loose.push(lines.join('\n'));
        }
    }

    return { blocks, loose, trailing: trailingComments(content, entries) };
}

export function sortCaddyfile(content) {
    const bom = content.startsWith('\ufeff') ? '\ufeff' : '';
    const { blocks, loose, trailing } = parseSiteBlocks(content.slice(bom.length));
    const globalBlocks = [];
    const snippetBlocks = [];
    const httpBlocks = [];
    const internalBlocks = [];
    const publicBlocks = [];

    for (const block of blocks) {
        const h = block.header.toLowerCase();
        if (h === '{') {
            globalBlocks.push(block);
        } else if (h.startsWith('(')) {
            // Snippets must be defined before a site imports them.
            snippetBlocks.push(block);
        } else if (h.startsWith('http://')) {
            httpBlocks.push(block);
        } else if (h.includes('.internal')) {
            internalBlocks.push(block);
        } else {
            publicBlocks.push(block);
        }
    }

    const sortByHeader = (a, b) => a.header.localeCompare(b.header);
    publicBlocks.sort(sortByHeader);
    internalBlocks.sort(sortByHeader);
    httpBlocks.sort(sortByHeader);

    const sorted = [...snippetBlocks, ...publicBlocks, ...internalBlocks, ...httpBlocks];
    const parts = globalBlocks.map(block => block.lines.join('\n'));
    if (loose.length) {
        parts.push(loose.join('\n'));
    }
    for (const block of sorted) {
        parts.push(block.lines.join('\n'));
    }
    if (trailing.length) {
        parts.push(trailing.join('\n'));
    }

    return bom + parts.join('\n\n').trimEnd() + '\n';
}

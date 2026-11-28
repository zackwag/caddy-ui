import { caddyfileChildren, extractGlobalBlock } from './caddyfileBlocks.js';
import { setGlobalOption } from './caddyfileGlobals.js';

// Whether Caddy's metrics are on in a Caddyfile's global options, either as
// `metrics` or in the older `servers { metrics }` form. The `metrics` handler of
// a site block is unrelated.

// Offsets of every metrics option in the whole file.
function metricsOptions(content) {
    const global = extractGlobalBlock(content);
    if (!global) return [];
    const within = (block, base) => caddyfileChildren(block.inner).flatMap(child => {
        const start = base + block.start + 1;
        if (child.name === 'metrics') return [{ start: start + child.start, end: start + child.end }];
        return child.name === 'servers' && child.block ? within(child.block, start) : [];
    });
    return within(global, 0);
}

export function metricsEnabled(content) {
    return metricsOptions(content).length > 0;
}

function removeLine(content, { start, end }) {
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const lineBreak = content.slice(end).match(/^[ \t]*\r?\n/);
    if (/^\s*$/.test(content.slice(lineStart, start)) && lineBreak) {
        return content.slice(0, lineStart) + content.slice(end + lineBreak[0].length);
    }
    return content.slice(0, start) + content.slice(end);
}

export function setMetricsEnabled(content, enabled) {
    if (!enabled) return metricsOptions(content).reverse().reduce(removeLine, content);
    if (metricsEnabled(content)) return content;
    return setGlobalOption(content, () => null, ({ indent }) => `${indent}metrics`);
}

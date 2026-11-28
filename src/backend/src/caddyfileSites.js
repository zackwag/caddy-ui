import { caddyfileEntries, siteDomain } from './caddyfileBlocks.js';

// Finding and editing one site's blocks in a Caddyfile, leaving the rest of it
// as written. `env` resolves {$VAR} site addresses.

function siteEntries(caddyfile, domain, env) {
    return caddyfileEntries(caddyfile).filter(entry => siteDomain(entry, env) === domain);
}

// Removes every top-level block for the domain and leaves the rest of the file
// as written, collapsing only the blank lines left where a block used to be.
export function removeSiteBlock(caddyfile, domain, env) {
    let result = caddyfile;
    for (const entry of siteEntries(caddyfile, domain, env).reverse()) {
        const before = result.slice(0, entry.lineStart);
        let after = result.slice(entry.lineEnd).replace(/^\r?\n/, '');
        if (!before.trim() || /\n[ \t]*\r?\n$/.test(before)) {
            after = after.replace(/^(?:[ \t]*\r?\n)+/, '');
        }
        result = before + after;
    }
    return result.trimEnd() + '\n';
}

export function appendSiteBlock(caddyfile, block) {
    return `${caddyfile.trimEnd()}\n\n${block}\n`;
}

export function replaceSiteBlock(caddyfile, domain, block, env) {
    return appendSiteBlock(removeSiteBlock(caddyfile, domain, env), block);
}

export function extractSiteBlock(caddyfile, domain, env) {
    return siteEntries(caddyfile, domain, env)[0]?.text ?? null;
}


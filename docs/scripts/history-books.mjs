import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SAXParser } from 'parse5-sax-parser';

export function bookFiles(directory) {
    const files = [];
    function walk(path) {
        for (const name of readdirSync(path).sort()) {
            const entry = join(path, name);
            const stat = lstatSync(entry);
            if (stat.isSymbolicLink()) throw new Error(`Book contains a symbolic link: ${entry}`);
            if (stat.isDirectory()) walk(entry);
            else if (stat.isFile()) files.push(relative(directory, entry).replaceAll('\\', '/'));
            else throw new Error(`Unsupported book entry: ${entry}`);
        }
    }
    walk(directory);
    return files;
}

// Hash names and complete bytes, including media and search. No wording,
// timestamps, links or whitespace are silently normalized away.
export function fingerprintBook(directory) {
    const hash = createHash('sha256');
    for (const name of bookFiles(directory)) {
        const bytes = readFileSync(join(directory, name));
        hash.update(`${Buffer.byteLength(name)}:${name}:${bytes.length}:`).update(bytes);
    }
    return hash.digest('hex');
}

export function validateBookAssets(directory) {
    const files = new Set(bookFiles(directory));
    if (!files.has('index.html') || ![...files].some(name => /^searchindex.*\.(js|json)$/.test(name))) {
        throw new Error('Book lacks its index or search index');
    }
    for (const name of files) {
        if (!name.endsWith('.html')) continue;
        const parser = new SAXParser();
        parser.on('startTag', token => {
            const attributes = Object.fromEntries(token.attrs.map(attr => [attr.name, attr.value]));
            const reference = ['img', 'script'].includes(token.tagName) ? attributes.src
                : token.tagName === 'link' && attributes.rel === 'stylesheet' ? attributes.href : null;
            if (!reference || /^(data:|https?:\/\/|\/\/)/.test(reference)) return;
            const path = decodeURIComponent(new URL(reference, `https://book.invalid/${name}`).pathname).slice(1);
            if (!files.has(path)) throw new Error(`${name} references missing local asset ${reference}`);
        });
        parser.end(readFileSync(join(directory, name), 'utf8'));
    }
}

export function groupBooks(releases, results, config = { schema: 1, aliases: {} }) {
    if (config.schema !== 1 || !config.aliases || Array.isArray(config.aliases) || typeof config.aliases !== 'object') {
        throw new Error('Grouping must contain schema: 1 and an aliases object');
    }
    const known = new Set(releases.map(release => release.tag));
    const built = new Map(results.filter(result => result.status === 'built').map(result => [result.tag, result]));
    const first = new Map();
    for (const release of releases) {
        const book = built.get(release.tag);
        if (book && !first.has(book.fingerprint)) first.set(book.fingerprint, release.tag);
    }
    for (const [tag, alias] of Object.entries(config.aliases)) {
        if (!known.has(tag) || !known.has(alias?.target) || tag === alias.target || typeof alias.reason !== 'string' || !alias.reason.trim()) {
            throw new Error(`Invalid maintainer alias for ${tag}: known distinct target and review reason required`);
        }
        if (!built.has(tag) || !built.has(alias.target)) throw new Error(`Alias ${tag} requires both historical books to build successfully`);
    }
    function target(tag, seen = new Set()) {
        if (seen.has(tag)) throw new Error(`Cyclic maintainer aliases at ${tag}`);
        seen.add(tag);
        return config.aliases[tag] ? target(config.aliases[tag].target, seen) : tag;
    }
    return releases.map(release => {
        const original = built.get(release.tag);
        if (!original) return { tag: release.tag, snapshot: null, source: null, grouping: null };
        const destination = target(release.tag);
        const fingerprint = built.get(destination).fingerprint;
        return { tag: release.tag, snapshot: fingerprint, source: first.get(fingerprint),
            grouping: config.aliases[release.tag] ? 'maintainer' : release.tag === first.get(fingerprint) ? 'original' : 'identical',
            ...(config.aliases[release.tag] ? { reason: config.aliases[release.tag].reason } : {}) };
    });
}

export function historyReport(inventory, results, groups) {
    const byTag = new Map(results.map(result => [result.tag, result]));
    const built = results.filter(result => result.status === 'built');
    const snapshots = new Set(built.map(result => result.fingerprint));
    const served = new Set(groups.map(group => group.snapshot).filter(Boolean));
    const lines = [
        '# Historical documentation backfill', '',
        `Source boundary: \`${inventory.throughCommit}\`. First candidate: **${inventory.from}**.`,
        `Publication evidence: \`${inventory.publicationsCommit}\` and its complete versions.json history.`, '',
        `${inventory.releases.length} candidates; ${built.length} built; ${results.filter(result => result.status === 'failed').length} failed; ${inventory.releases.length - results.length} pending.`,
        `${snapshots.size} byte-distinct books; ${served.size} selected snapshots after explicit grouping.`, '',
        'Image versions below are recorded successful publications, not a live registry availability check.',
        'Each book uses the source commit of its own release; shared books retain every release mapping.', '',
        '| Release | Frontend image | Backend image | Build | Selected book | Grouping |',
        '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const release of inventory.releases) {
        const result = byTag.get(release.tag);
        const group = groups.find(group => group.tag === release.tag);
        lines.push(`| ${release.tag} | ${release.images.frontend?.version || 'Not recorded'} | ${release.images.backend?.version || 'Not recorded'} | ${result?.status || 'pending'} | ${group?.source || '—'} | ${group?.grouping || '—'} |`);
    }
    lines.push('', '## Build provenance', '');
    for (const result of results) {
        lines.push(`- **${result.tag}**: ${result.status === 'built' ? `SHA-256 \`${result.fingerprint}\`; screenshots: ${result.screenshots}; coverage: ${result.coverage}; ${result.tools}.` : result.error} Log: \`logs/${result.tag}.log\`.`);
    }
    const manual = groups.filter(group => group.grouping === 'maintainer');
    if (manual.length) lines.push('', '## Maintainer decisions', '', ...manual.map(group => `- ${group.tag} → ${group.source}: ${group.reason}`));
    return lines.join('\n') + '\n';
}

export function validateBookResults(directory, inventory, results) {
    if (!Array.isArray(results) || new Set(results.map(result => result.tag)).size !== results.length) throw new Error('Invalid backfill results');
    for (const result of results) {
        if (!inventory.releases.some(release => release.tag === result.tag && release.commit === result.commit)
            || !['built', 'failed'].includes(result.status)) throw new Error(`Invalid backfill result for ${result.tag}`);
        if (result.status === 'built' && (!/^[a-f0-9]{64}$/.test(result.fingerprint)
            || fingerprintBook(join(directory, 'books', result.fingerprint)) !== result.fingerprint)) {
            throw new Error(`Snapshot integrity check failed for ${result.tag}`);
        }
    }
}

export function writeBookReport(directory, inventory, results, config) {
    validateBookResults(directory, inventory, results);
    const groups = groupBooks(inventory.releases, results, config);
    writeFileSync(join(directory, 'groups.json'), JSON.stringify({ schema: 1, releases: groups }, null, 2) + '\n');
    writeFileSync(join(directory, 'report.md'), historyReport(inventory, results, groups));
    return groups;
}

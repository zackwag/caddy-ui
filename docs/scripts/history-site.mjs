import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAXParser } from 'parse5-sax-parser';
import { bookFiles, groupBooks, validateBookAssets, validateBookResults } from './history-books.mjs';
import { validateInventory } from './history-backfill.mjs';
import { compareVersions, git, options, repository } from './history-inventory.mjs';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const legacyTag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/;
const sortableVersion = tag => tag.split('.').length === 2 ? tag + '.0' : tag;

export function siteBase(value) {
    if (!/^\/(?:[A-Za-z0-9_.-]+\/)*$/.test(value) || value.split('/').some(part => part === '.' || part === '..')) {
        throw new Error('Site base must be / or a slash-terminated repository path');
    }
    return value;
}

export function legacyReleases(root, inventory) {
    validateInventory(inventory);
    return git(root, ['tag', '--merged', inventory.throughCommit]).split('\n')
        .filter(tag => legacyTag.test(tag) && compareVersions(sortableVersion(tag), inventory.from) < 0)
        .map(tag => ({ tag, commit: git(root, ['rev-parse', '--verify', `${tag}^{commit}`]),
            images: { frontend: null, backend: null } }));
}

// Add publication chrome by token positions. Literal HTML in examples/comments
// and the archived source snapshots are left untouched.
export function decorateBookHtml(source, { assets, base, book, path, commit, label }) {
    const parser = new SAXParser({ sourceCodeLocationInfo: true });
    const edits = [];
    let head, body;
    parser.on('endTag', token => {
        if (token.tagName === 'head') head = token.sourceCodeLocation.startOffset;
        if (token.tagName === 'body') body = token.sourceCodeLocation.startOffset;
    });
    parser.on('startTag', token => {
        const attrs = Object.fromEntries(token.attrs.map(attr => [attr.name, attr.value]));
        let href;
        if (token.tagName === 'base' && attrs.href) href = base + path;
        const editPrefix = `https://github.com/${repository}/edit/main/docs/`;
        if (commit && token.tagName === 'a' && attrs.href?.startsWith(editPrefix)) {
            href = `https://github.com/${repository}/blob/${commit}/docs/` + attrs.href.slice(editPrefix.length);
        }
        if (href) {
            const location = token.sourceCodeLocation.attrs.href;
            edits.push({ start: location.startOffset, end: location.endOffset, text: `href="${escape(href)}"` });
        }
    });
    parser.end(source);
    if (head === undefined || body === undefined) throw new Error('Book page has no HTML head/body');
    edits.push({ start: head, end: head, text: `<link rel="stylesheet" href="${assets}versions.css">\n` });
    edits.push({ start: body, end: body, text: `<noscript><p class="docs-version-noscript">${escape(label)}</p></noscript>\n`
        + `<script type="module" src="${assets}versions.js" data-docs-book="${book}" data-docs-base="${path}"></script>\n` });
    for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    return source;
}

function resolverPage(assets, tag = '') {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Choose documentation · caddy/ui</title><link rel="stylesheet" href="${assets}versions.css"></head>
<body class="docs-resolver"><main><h1>caddy/ui documentation</h1><div id="docs-resolution" aria-live="polite">Finding documentation…</div>
<noscript><p>Enable JavaScript to select a documentation version, or open the <a href="https://github.com/${repository}/releases">release notes</a>.</p></noscript>
</main><script type="module" src="${assets}resolve.js" data-docs-version="${escape(tag)}"></script></body></html>\n`;
}

export function publishSite({ root, archive, developmentBook, output, base = '/caddy-ui/', developmentCommit, grouping, older = [] }) {
    siteBase(base);
    if (!/^[a-f0-9]{40}$/.test(developmentCommit)) throw new Error('Development source must be a commit ID');
    const manifest = JSON.parse(readFileSync(join(archive, 'backfill.json'), 'utf8'));
    if (manifest.schema !== 1) throw new Error('Unsupported archive manifest');
    validateInventory(manifest.inventory);
    validateBookResults(archive, manifest.inventory, manifest.results);
    validateBookAssets(developmentBook);
    if (manifest.results.length !== manifest.inventory.releases.length) throw new Error('Crawl is incomplete; refusing to publish a partial catalogue');
    for (const release of older) {
        if (!legacyTag.test(release.tag) || !/^[a-f0-9]{40}$/.test(release.commit)) throw new Error('Invalid legacy release');
    }
    const groups = groupBooks(manifest.inventory.releases, manifest.results, grouping);
    const pages = directory => bookFiles(directory).filter(name => name.endsWith('.html'));
    const catalog = { schema: 1, repository, development: { path: 'dev/', commit: developmentCommit, pages: pages(developmentBook) }, books: {}, releases: [] };
    const snapshots = new Map();
    for (const group of groups.filter(group => group.snapshot)) {
        const source = manifest.inventory.releases.find(release => release.tag === group.source);
        snapshots.set(group.snapshot, source.commit);
    }
    for (const [fingerprint, sourceCommit] of snapshots) {
        const source = join(archive, 'books', fingerprint);
        validateBookAssets(source);
        catalog.books[fingerprint] = { path: `books/${fingerprint}/`, sourceCommit, pages: pages(source) };
    }
    catalog.releases = [...manifest.inventory.releases.map(release => {
        const group = groups.find(group => group.tag === release.tag);
        return { ...release, snapshot: group.snapshot, source: group.source, grouping: group.grouping,
            ...(group.reason ? { reason: group.reason } : {}) };
    }),
    ...older.map(release => ({ ...release, snapshot: null, grouping: null }))]
        .sort((a, b) => compareVersions(sortableVersion(b.tag), sortableVersion(a.tag)));
    if (new Set(catalog.releases.map(release => release.tag)).size !== catalog.releases.length) throw new Error('Duplicate release in catalogue');
    for (const input of [archive, developmentBook]) {
        if (resolve(output) === resolve(input) || resolve(output).startsWith(resolve(input) + '/') || resolve(input).startsWith(resolve(output) + '/')) {
            throw new Error('Site output must not overlap its inputs');
        }
    }
    mkdirSync(dirname(output), { recursive: true });
    const temporary = mkdtempSync(output + '.tmp-');
    const backup = temporary + '.previous';
    let moved = false;
    try {
        function copyBook(source, path, book, commit, label) {
            const destination = join(temporary, path);
            cpSync(source, destination, { recursive: true });
            for (const page of pages(source)) {
                const file = join(destination, page);
                const assets = (posix.relative(posix.dirname(path + page), '_versions') || '.') + '/';
                writeFileSync(file, decorateBookHtml(readFileSync(file, 'utf8'), { assets, base, book, path, commit, label }));
            }
        }
        copyBook(developmentBook, '', 'development', null, 'Development documentation');
        copyBook(developmentBook, 'dev/', 'development', null, 'Development documentation');
        for (const [fingerprint, commit] of snapshots) {
            copyBook(join(archive, 'books', fingerprint), catalog.books[fingerprint].path, fingerprint, commit, 'Archived release documentation');
        }
        mkdirSync(join(temporary, '_versions'));
        for (const file of ['versions.js', 'versions-model.js', 'versions.css', 'resolve.js']) {
            cpSync(join(root, 'docs/theme', file), join(temporary, '_versions', file));
        }
        writeFileSync(join(temporary, 'documentation.json'), JSON.stringify(catalog, null, 2) + '\n');
        writeFileSync(join(temporary, 'resolve.html'), resolverPage('_versions/'));
        for (const release of catalog.releases) {
            const directory = join(temporary, 'versions', release.tag);
            mkdirSync(directory, { recursive: true });
            writeFileSync(join(directory, 'index.html'), resolverPage('../../_versions/', release.tag));
        }
        writeFileSync(join(temporary, '.nojekyll'), '');
        if (existsSync(output)) { renameSync(output, backup); moved = true; }
        try { renameSync(temporary, output); }
        catch (error) { if (moved) renameSync(backup, output); throw error; }
        if (moved) rmSync(backup, { recursive: true });
        return catalog;
    } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const args = options(process.argv.slice(2), ['repo', 'archive', 'development', 'output', 'base']);
        const root = resolve(args.repo || fileURLToPath(new URL('../..', import.meta.url)));
        const archive = resolve(args.archive || root + '/.docs-history');
        const manifest = JSON.parse(readFileSync(join(archive, 'backfill.json'), 'utf8'));
        const catalog = publishSite({ root, archive, developmentBook: resolve(args.development || root + '/docs/book'),
            output: resolve(args.output || root + '/.docs-site'), base: args.base || '/caddy-ui/', developmentCommit: git(root, ['rev-parse', 'HEAD']),
            grouping: JSON.parse(readFileSync(join(root, 'docs/history/groups.json'), 'utf8')), older: legacyReleases(root, manifest.inventory) });
        console.log(`Published development documentation and ${catalog.releases.length} release entries (${Object.keys(catalog.books).length} shared books).`);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fingerprintBook } from './history-books.mjs';
import { decorateBookHtml, publishSite, siteBase } from './history-site.mjs';

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
const sha = 'a'.repeat(40);
const source = '<!doctype html><html><head><!-- </head> --><title>Book</title></head><body>'
    + '<a href="https://github.com/zackwag/caddy-ui/edit/main/docs/src/about.md">Edit</a>'
    + '<script>const example = "</body>";</script><main>Historical text</main></body></html>';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'docs-site-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const developmentBook = join(root, 'development');
    mkdirSync(developmentBook);
    writeFileSync(join(developmentBook, 'index.html'), source);
    writeFileSync(join(developmentBook, 'searchindex.js'), 'Search');
    const fingerprint = fingerprintBook(developmentBook);
    const archive = join(root, 'archive');
    mkdirSync(join(archive, 'books', fingerprint), { recursive: true });
    for (const file of ['index.html', 'searchindex.js']) writeFileSync(join(archive, 'books', fingerprint, file), readFileSync(join(developmentBook, file)));
    const releases = ['v2.20.0', 'v2.20.1', 'v2.20.2'].map(tag => ({ tag, commit: sha, hasBook: true,
        images: { frontend: { version: tag.slice(1), recordedAt: sha }, backend: { version: tag.slice(1), recordedAt: sha } } }));
    const inventory = { schema: 1, repository: 'zackwag/caddy-ui', from: 'v2.20.0', throughCommit: sha, publicationsCommit: sha, releases };
    const results = releases.map((release, i) => ({ tag: release.tag, commit: sha,
        ...(i === 2 ? { status: 'failed', error: 'No renderer' } : { status: 'built', fingerprint }) }));
    writeFileSync(join(archive, 'backfill.json'), JSON.stringify({ schema: 1, inventory,
        inventoryFingerprint: createHash('sha256').update(JSON.stringify(inventory)).digest('hex'), results }));
    return { root: sourceRoot, developmentBook, archive, output: join(root, 'site'), base: '/caddy-ui/', developmentCommit: sha,
        older: [{ tag: 'v1.13', commit: sha, images: { frontend: null, backend: null } }], fingerprint };
}

test('publication keeps old URLs, shares complete books, and adds immutable source links without editing archived bytes', t => {
    const f = fixture(t);
    const catalog = publishSite(f);
    assert.equal(Object.keys(catalog.books).length, 1);
    assert.equal(catalog.releases.length, 4);
    assert.equal(catalog.releases.find(release => release.tag === 'v2.20.1').source, 'v2.20.0');
    assert.equal(catalog.books[f.fingerprint].sourceCommit, sha);
    for (const path of ['index.html', 'dev/index.html', `books/${f.fingerprint}/index.html`, 'versions/v2.20.1/index.html', 'resolve.html']) {
        assert(existsSync(join(f.output, path)), path);
    }
    const html = readFileSync(join(f.output, `books/${f.fingerprint}/index.html`), 'utf8');
    assert.match(html, /src="\.\.\/\.\.\/_versions\/versions.js"/);
    assert.match(html, new RegExp(`/blob/${sha}/docs/src/about.md`));
    assert(html.includes('const example = "</body>";'));
    assert.equal(readFileSync(join(f.archive, 'books', f.fingerprint, 'index.html'), 'utf8'), source);
    assert.equal(fingerprintBook(join(f.archive, 'books', f.fingerprint)), f.fingerprint);
    assert.match(readFileSync(join(f.output, 'index.html'), 'utf8'), /data-docs-book="development"/);
});

test('publication validates all payloads before replacing a previously working site', t => {
    const f = fixture(t);
    publishSite(f);
    const previous = readFileSync(join(f.output, 'documentation.json'), 'utf8');
    assert.throws(() => publishSite({ ...f, output: dirname(f.archive) }), /overlap/);
    const manifestPath = join(f.archive, 'backfill.json');
    const complete = readFileSync(manifestPath, 'utf8');
    const incomplete = JSON.parse(complete);
    incomplete.results.pop();
    writeFileSync(manifestPath, JSON.stringify(incomplete));
    assert.throws(() => publishSite(f), /incomplete/);
    assert.equal(readFileSync(join(f.output, 'documentation.json'), 'utf8'), previous);
    writeFileSync(manifestPath, complete);
    writeFileSync(join(f.archive, 'books', f.fingerprint, 'index.html'), 'Tampered');
    assert.throws(() => publishSite(f), /integrity check/);
    assert.equal(readFileSync(join(f.output, 'documentation.json'), 'utf8'), previous);
    for (const bad of ['//example.com/', '../', '/caddy-ui', '/a/../']) assert.throws(() => siteBase(bad));
});

test('publication discovers releases independently while preserving archived bytes and checking source identities', t => {
    const f = fixture(t);
    const manifestPath = join(f.archive, 'backfill.json');
    const preserved = readFileSync(manifestPath, 'utf8');
    const inventory = JSON.parse(preserved).inventory;
    inventory.releases[0].images.backend = null;
    inventory.releases.push({ ...inventory.releases[1], tag: 'v2.20.3', commit: 'b'.repeat(40), images: { frontend: null, backend: null } });
    const catalog = publishSite({ ...f, inventory });
    assert.equal(catalog.releases.find(release => release.tag === 'v2.20.3').snapshot, null);
    assert(existsSync(join(f.output, 'versions/v2.20.3/index.html')));
    assert.equal(catalog.releases.find(release => release.tag === 'v2.20.0').images.backend, null);
    assert.equal(readFileSync(manifestPath, 'utf8'), preserved, 'publication never rewrites the preserved archive');
    assert.equal(fingerprintBook(join(f.archive, 'books', f.fingerprint)), f.fingerprint);
    const published = readFileSync(join(f.output, 'documentation.json'), 'utf8');
    inventory.releases[0].commit = 'c'.repeat(40);
    assert.throws(() => publishSite({ ...f, inventory }), /changed or removed/);
    assert.equal(readFileSync(join(f.output, 'documentation.json'), 'utf8'), published);
    inventory.releases.shift();
    assert.throws(() => publishSite({ ...f, inventory }), /changed or removed/);
});

test('HTML decoration uses actual tags and fixes the mdBook 404 base for project Pages', () => {
    const html = decorateBookHtml(source.replace('<title>', '<base href="/"><title>'), {
        assets: '../../../_versions/', base: '/caddy-ui/', path: 'books/book/', book: 'book', commit: sha, label: 'Release',
    });
    assert.match(html, /<base href="\/caddy-ui\/books\/book\/">/);
    assert(html.includes('<!-- </head> -->'));
    assert(html.includes('const example = "</body>";'));
});

test('release publication requires collection evidence and never replaces the site with an uncollected release', t => {
    const f = fixture(t);
    publishSite({ ...f, requireCollected: true });
    const catalogPath = join(f.output, 'documentation.json');
    const previous = readFileSync(catalogPath, 'utf8');
    const manifest = JSON.parse(readFileSync(join(f.archive, 'backfill.json'), 'utf8'));
    const inventory = structuredClone(manifest.inventory);
    const release = { ...inventory.releases[0], tag: 'v2.20.3', commit: 'b'.repeat(40), images: { frontend: null, backend: null } };
    inventory.releases.push(release);
    assert.throws(() => publishSite({ ...f, inventory, requireCollected: true }), /has not covered: v2.20.3/);
    assert.equal(readFileSync(catalogPath, 'utf8'), previous);
    // A recorded historical rendering failure is still an explicit fallback;
    // a release the collector never attempted cannot masquerade as one.
    manifest.inventory = inventory;
    manifest.inventoryFingerprint = createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
    manifest.results.push({ tag: release.tag, commit: release.commit, status: 'failed', error: 'Historical rendering failed' });
    writeFileSync(join(f.archive, 'backfill.json'), JSON.stringify(manifest));
    const catalog = publishSite({ ...f, inventory, requireCollected: true });
    assert.equal(catalog.releases.find(entry => entry.tag === release.tag).snapshot, null);
});


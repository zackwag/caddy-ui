import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { githubStore, publishArchive, restoreArchive } from './history-archive.mjs';
import { fingerprintBook, writeBookReport } from './history-books.mjs';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'history-archive-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const directory = join(root, 'archive');
    const book = join(directory, 'books', 'building');
    mkdirSync(book, { recursive: true });
    mkdirSync(join(directory, 'logs'));
    writeFileSync(join(book, 'index.html'), '<html><body>Historical book</body></html>');
    writeFileSync(join(book, 'searchindex.js'), 'const search = [];');
    const fingerprint = fingerprintBook(book);
    // Keep the snapshot path content-addressed, as in the real backfill.
    const commit = 'a'.repeat(40);
    const release = { tag: 'v2.20.0', commit, hasBook: true, images: { frontend: null, backend: null } };
    const inventory = { schema: 1, repository: 'zackwag/caddy-ui', from: release.tag,
        throughCommit: commit, publicationsCommit: commit, releases: [release] };
    const results = [{ tag: release.tag, commit, status: 'built', fingerprint, tools: 'Fixture', screenshots: 'Fixture', coverage: 'Fixture' }];
    const grouping = { schema: 1, aliases: {} };
    const groupingPath = join(root, 'grouping.json');
    writeFileSync(groupingPath, JSON.stringify(grouping));
    writeFileSync(join(directory, 'logs', release.tag + '.log'), 'Original build log\n');
    const write = () => {
        const inventoryFingerprint = createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
        writeFileSync(join(directory, 'backfill.json'), JSON.stringify({ schema: 1, inventoryFingerprint, inventory, results }));
        writeBookReport(directory, inventory, results, grouping);
    };
    renameSync(book, join(directory, 'books', fingerprint));
    write();
    const assets = [];
    const store = {
        failCheckpoint: false,
        list: () => assets,
        download: (asset, path) => writeFileSync(path, asset.bytes),
        upload(path) {
            const name = basename(path);
            if (store.failCheckpoint && name.endsWith('.json')) {
                throw new Error('Interrupted checkpoint upload');
            }
            assets.push({ id: assets.length + 1, name, created_at: new Date(assets.length * 1000).toISOString(), bytes: readFileSync(path) });
        },
    };
    return { root, directory, inventory, results, fingerprint, assets, store, write,
        settings: { directory, grouping: groupingPath, store, sourceCommit: commit } };
}

test('release archives round-trip books, provenance and logs, and unchanged crawls create no assets', t => {
    const f = fixture(t);
    assert.equal(publishArchive(f.settings).published, true);
    assert.equal(f.assets.length, 2);
    const restored = join(f.root, 'restored');
    assert.equal(restoreArchive({ directory: restored, store: f.store }), true);
    assert.equal(fingerprintBook(join(restored, 'books', f.fingerprint)), f.fingerprint);
    assert.equal(readFileSync(join(restored, 'logs/v2.20.0.log'), 'utf8'), 'Original build log\n');
    assert.deepEqual(JSON.parse(readFileSync(join(restored, 'backfill.json'))).inventory, f.inventory);
    f.inventory.throughCommit = 'b'.repeat(40);
    f.write();
    assert.equal(publishArchive(f.settings).published, false, 'a main change without new releases does not upload another archive');
    assert.equal(f.assets.length, 2);
});

test('only explicit bootstrap permits an absent archive; lookup errors never become empty history', t => {
    const f = fixture(t);
    const directory = join(f.root, 'empty');
    assert.throws(() => restoreArchive({ directory, store: f.store }), /explicit bootstrap/);
    assert.equal(restoreArchive({ directory, store: f.store, bootstrap: true }), false);
    assert.equal(existsSync(directory), false);
    assert.throws(() => restoreArchive({ directory, bootstrap: true,
        store: { list() { throw new Error('Authentication failed'); } } }), /Authentication failed/);
});

test('a changed payload or missing asset fails without replacing history, including in bootstrap mode', t => {
    const f = fixture(t);
    publishArchive(f.settings);
    const archive = f.assets.find(asset => asset.name.endsWith('.tar.gz'));
    archive.bytes = Buffer.from('Corrupt archive');
    const directory = join(f.root, 'restore-corrupt');
    assert.throws(() => restoreArchive({ directory, store: f.store, bootstrap: true }), /checksum or size/);
    assert.equal(existsSync(directory), false);
    f.assets.splice(f.assets.indexOf(archive), 1);
    assert.throws(() => restoreArchive({ directory, store: f.store }), /no corresponding payload/);
});

test('an interrupted upload leaves the previous checkpoint usable; a later crawl preserves failures explicitly', t => {
    const f = fixture(t);
    publishArchive(f.settings);
    f.inventory.releases.push({ ...f.inventory.releases[0], tag: 'v2.20.1' });
    f.results.push({ tag: 'v2.20.1', commit: f.settings.sourceCommit, status: 'failed', error: 'Historical renderer failed' });
    f.write();
    f.store.failCheckpoint = true;
    assert.throws(() => publishArchive(f.settings), /Interrupted checkpoint/);
    const restored = join(f.root, 'previous');
    restoreArchive({ directory: restored, store: f.store });
    assert.equal(JSON.parse(readFileSync(join(restored, 'backfill.json'))).results.length, 1);
    f.store.failCheckpoint = false;
    assert.deepEqual(publishArchive(f.settings).checkpoint.failed, ['v2.20.1']);
    const extended = join(f.root, 'extended');
    restoreArchive({ directory: extended, store: f.store });
    assert.deepEqual(JSON.parse(readFileSync(join(extended, 'backfill.json'))).results.map(result => result.status), ['built', 'failed']);
    assert.equal(fingerprintBook(join(extended, 'books', f.fingerprint)), f.fingerprint);
});

test('corrupted local snapshots cannot replace a preserved archive', t => {
    const f = fixture(t);
    publishArchive(f.settings);
    writeFileSync(join(f.directory, 'books', f.fingerprint, 'index.html'), 'Changed bytes');
    assert.throws(() => publishArchive(f.settings), /integrity check/);
    assert.equal(f.assets.length, 2);
});

test('GitHub storage paginates assets without newer CLI flags and distinguishes missing releases from access errors', t => {
    const f = fixture(t);
    const bin = join(f.root, 'bin');
    mkdirSync(bin);
    const executable = join(bin, 'gh');
    writeFileSync(executable, `#!${process.execPath}
const path = process.argv[3];
if (process.env.ARCHIVE_TEST_STATUS) {
    console.error('gh: fixture failure (HTTP ' + process.env.ARCHIVE_TEST_STATUS + ')');
    process.exit(1);
}
if (process.argv[2] !== 'api' || path.startsWith('--')) process.exit(2);
if (path.endsWith('/releases/tags/documentation-history-archive')) {
    console.log(JSON.stringify({ id: 1 }));
} else {
    const match = /assets\\?per_page=100&page=([123])$/.exec(path);
    if (!match) process.exit(2);
    const page = Number(match[1]);
    console.log(JSON.stringify(Array.from({ length: page < 3 ? 100 : 1 }, (_, i) => ({
        id: (page - 1) * 100 + i, name: 'fixture-' + ((page - 1) * 100 + i),
    }))));
}
`);
    chmodSync(executable, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = bin + ':' + previousPath;
    t.after(() => {
        process.env.PATH = previousPath;
        delete process.env.ARCHIVE_TEST_STATUS;
    });
    const store = githubStore('juscghwe/caddy-ui');
    const assets = store.list();
    assert.equal(assets.length, 201);
    assert.equal(assets.at(-1).id, 200);
    process.env.ARCHIVE_TEST_STATUS = '404';
    assert.equal(store.list(), null);
    process.env.ARCHIVE_TEST_STATUS = '403';
    assert.throws(() => store.list(), /HTTP 403/);
});

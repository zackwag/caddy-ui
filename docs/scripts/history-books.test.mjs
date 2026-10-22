import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fingerprintBook, groupBooks, historyReport, validateBookAssets, writeBookReport } from './history-books.mjs';

function book(t) {
    const path = mkdtempSync(join(tmpdir(), 'history-book-'));
    t.after(() => rmSync(path, { recursive: true, force: true }));
    writeFileSync(join(path, 'index.html'), '<img src="image.png"><script src="searchindex-a.js"></script>');
    writeFileSync(join(path, 'searchindex-a.js'), 'Search index');
    writeFileSync(join(path, 'image.png'), Buffer.from([1, 2, 3]));
    return path;
}

test('exact fingerprints include paths, wording, binary assets and search bytes', t => {
    const first = book(t), second = book(t);
    const original = fingerprintBook(first);
    assert.equal(fingerprintBook(second), original);
    for (const [name, bytes] of [['image.png', Buffer.from([3, 2, 1])], ['searchindex-a.js', 'Changed search'], ['index.html', 'Tiny wording fix']]) {
        const path = book(t);
        writeFileSync(join(path, name), bytes);
        assert.notEqual(fingerprintBook(path), original);
    }
    writeFileSync(join(second, 'extra.css'), '');
    assert.notEqual(fingerprintBook(second), original);
    symlinkSync(join(first, 'image.png'), join(first, 'linked.png'));
    assert.throws(() => fingerprintBook(first), /symbolic link/);
});

test('asset validation handles nested pages and rejects missing media or search indexes', t => {
    const path = book(t);
    mkdirSync(join(path, 'nested'));
    writeFileSync(join(path, 'nested/page.html'), '<img src="../image.png"><img src="https://example.org/external.png">');
    validateBookAssets(path);
    rmSync(join(path, 'image.png'));
    assert.throws(() => validateBookAssets(path), /missing local asset/);
    rmSync(join(path, 'searchindex-a.js'));
    assert.throws(() => validateBookAssets(path), /search index/);
});

test('reports reject snapshots changed after backfill instead of advertising stale fingerprints', t => {
    const root = book(t);
    const path = join(root, 'books');
    mkdirSync(path);
    const snapshot = book(t);
    const fingerprint = fingerprintBook(snapshot);
    // A wrong payload under an otherwise valid content-addressed directory.
    mkdirSync(join(path, fingerprint));
    writeFileSync(join(path, fingerprint, 'index.html'), 'Changed after backfill');
    const releases = [{ tag: 'v2.20.0', commit: 'source' }];
    const results = [{ tag: 'v2.20.0', commit: 'source', status: 'built', fingerprint }];
    assert.throws(() => writeBookReport(root, { releases }, results), /integrity check/);
});

const releases = ['v2.20.0', 'v2.20.1', 'v2.20.2', 'v2.21.0'].map(tag => ({ tag, images: { frontend: null, backend: null } }));
const results = [
    { tag: 'v2.20.0', status: 'built', fingerprint: 'a' },
    { tag: 'v2.20.1', status: 'built', fingerprint: 'a' },
    { tag: 'v2.20.2', status: 'built', fingerprint: 'b' },
    { tag: 'v2.21.0', status: 'failed', error: 'mdBook failed' },
];

test('automatic grouping shares identical books while preserving every release mapping', () => {
    const groups = groupBooks(releases, results);
    assert.equal(groups.length, 4);
    assert.deepEqual(groups.map(group => group.grouping), ['original', 'identical', 'original', null]);
    assert.equal(groups[1].source, 'v2.20.0');
    assert.equal(groups[2].snapshot, 'b');
    assert.equal(groups[3].snapshot, null);
});

test('maintainer grouping requires successful builds and a recorded reason, and refuses cycles or unknown tags', () => {
    const alias = (target, reason = 'Reviewed wording-only diff') => ({ target, reason });
    const config = aliases => ({ schema: 1, aliases });
    const groups = groupBooks(releases, results, config({ 'v2.20.2': alias('v2.20.0') }));
    assert.equal(groups[2].snapshot, 'a');
    assert.equal(groups[2].reason, 'Reviewed wording-only diff');
    assert.equal(results[2].fingerprint, 'b', 'the original historical fingerprint remains available');
    for (const aliases of [
        { 'v2.20.2': alias('v9.0.0') }, { 'v2.20.2': alias('v2.20.0', '') },
        { 'v2.21.0': alias('v2.20.0') }, { 'v2.20.0': alias('v2.20.2'), 'v2.20.2': alias('v2.20.0') },
    ]) assert.throws(() => groupBooks(releases, results, config(aliases)));
    const report = historyReport({ from: 'v2.20.0', throughCommit: 'source', publicationsCommit: 'evidence', releases }, results, groups);
    assert.match(report, /2 byte-distinct books; 1 selected snapshot/);
    assert.match(report, /Reviewed wording-only diff/);
    assert.match(report, /Not recorded/);
});

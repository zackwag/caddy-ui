import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { backfill, validateInventory } from './history-backfill.mjs';
import { git } from './history-inventory.mjs';

test('a failed historical build is recorded, cleans up its worktree, and can be retried without erasing provenance', async t => {
    const root = mkdtempSync(join(tmpdir(), 'backfill-fixture-'));
    const originalPath = process.env.PATH;
    t.after(() => {
        process.env.PATH = originalPath;
        delete process.env.BACKFILL_TEST_FAIL;
        delete process.env.BACKFILL_TEST_MARKER;
        rmSync(root, { recursive: true, force: true });
    });
    git(root, ['init', '-q', '--initial-branch=main']);
    git(root, ['config', 'user.name', 'juscghwe']);
    git(root, ['config', 'user.email', '62502225+juscghwe@users.noreply.github.com']);
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs/book.toml'), '[book]\ntitle="Fixture"\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'Fixture']);
    const commit = git(root, ['rev-parse', 'HEAD']);
    git(root, ['tag', 'v2.20.0']);
    const inventory = { schema: 1, repository: 'zackwag/caddy-ui', from: 'v2.20.0', throughCommit: commit, publicationsCommit: commit,
        releases: [{ tag: 'v2.20.0', commit, images: { frontend: null, backend: null }, hasBook: true }] };
    const binaries = join(root, 'bin');
    mkdirSync(binaries);
    function executable(name, body) {
        const path = join(binaries, name);
        writeFileSync(path, `#!${process.execPath}\n${body}\n`);
        chmodSync(path, 0o755);
        return path;
    }
    executable('npm', "if (process.argv.includes('--version')) console.log('test');");
    const mdbook = executable('mdbook', `
        const fs = require('node:fs');
        if (process.argv.includes('--version')) console.log('mdbook v0.5.4');
        else if (process.env.BACKFILL_TEST_FAIL === 'wait') {
            fs.writeFileSync(process.env.BACKFILL_TEST_MARKER, 'building');
            setTimeout(() => process.exit(1), 30000);
        }
        else if (process.env.BACKFILL_TEST_FAIL) process.exit(1);
        else {
            fs.mkdirSync('docs/book', { recursive: true });
            fs.writeFileSync('docs/book/index.html', 'Historical source');
            fs.writeFileSync('docs/book/searchindex.js', 'Historical search');
        }
    `);
    process.env.PATH = binaries + ':' + originalPath;
    const output = join(root, 'results');
    const settings = { root, output, inventory, mdbook, notify: () => {} };
    process.env.BACKFILL_TEST_FAIL = '1';
    const failed = await backfill(settings);
    assert.equal(failed.results[0].status, 'failed');
    assert.match(failed.results[0].error, /mdBook/);
    assert.equal((git(root, ['worktree', 'list', '--porcelain']).match(/^worktree /gm) || []).length, 1);
    assert.equal(existsSync(join(output, '.lock')), false);
    delete process.env.BACKFILL_TEST_FAIL;
    const built = await backfill(settings);
    assert.equal(built.results[0].status, 'built');
    assert.equal(built.results[0].commit, commit);
    assert.equal(readFileSync(join(output, 'books', built.results[0].fingerprint, 'index.html'), 'utf8'), 'Historical source');
    assert.equal(JSON.parse(readFileSync(join(output, 'backfill.json'))).inventory.releases[0].commit, commit);

    const incremental = join(root, 'incremental');
    cpSync(output, incremental, { recursive: true });
    git(root, ['tag', 'v2.20.9']);
    const extended = { ...inventory, releases: [...inventory.releases, { ...inventory.releases[0], tag: 'v2.20.9' }] };
    const crawl = { ...settings, output: incremental, inventory: extended, reuse: true };
    process.env.BACKFILL_TEST_FAIL = '1';
    const partial = await backfill(crawl);
    assert.deepEqual(partial.results.map(r => r.status), ['built', 'failed'], 'only the newly discovered release is built');
    delete process.env.BACKFILL_TEST_FAIL;
    assert.deepEqual((await backfill(crawl)).results.map(r => r.status), ['built', 'failed'], 'failed releases are not silently retried');
    const retried = await backfill({ ...crawl, retryFailed: true });
    assert.deepEqual(retried.results.map(r => r.status), ['built', 'built']);
    assert.equal(retried.results[0].fingerprint, built.results[0].fingerprint, 'published source snapshots are reused unchanged');
    await assert.rejects(backfill({ ...crawl, inventory: { ...extended,
        releases: extended.releases.map(r => r.tag === 'v2.20.0' ? { ...r, commit: 'a'.repeat(40) } : r),
    } }), /source changed or disappeared/);
    writeFileSync(join(incremental, 'books', built.results[0].fingerprint, 'index.html'), 'Corrupt cached payload');
    await assert.rejects(backfill(crawl), /integrity check/);

    process.env.BACKFILL_TEST_FAIL = 'wait';
    process.env.BACKFILL_TEST_MARKER = join(root, 'building');
    const controller = new AbortController();
    const stopped = assert.rejects(backfill({ ...settings, signal: controller.signal }), /abort/i);
    for (let i = 0; i < 200 && !existsSync(process.env.BACKFILL_TEST_MARKER); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert(existsSync(process.env.BACKFILL_TEST_MARKER), 'the historical build started inside its worktree');
    controller.abort();
    await stopped;
    assert.equal(existsSync(join(output, '.lock')), false);
    assert.equal((git(root, ['worktree', 'list', '--porcelain']).match(/^worktree /gm) || []).length, 1);
    assert.equal(JSON.parse(readFileSync(join(output, 'backfill.json'))).results[0].status, 'built');
    await assert.rejects(backfill({ ...settings, inventory: { ...inventory, throughCommit: 'a'.repeat(40) } }), /different inventory/);
    assert.equal(existsSync(join(output, '.lock')), false);
    await assert.rejects(backfill({ ...settings, selected: '../outside' }), /inventory tags/);
    assert.throws(() => validateInventory({ ...inventory, releases: [{ ...inventory.releases[0], tag: '../../outside' }] }), /Invalid release/);
    delete process.env.BACKFILL_TEST_FAIL;
    mkdirSync(join(root, 'docs/screenshots'));
    writeFileSync(join(root, 'docs/screenshots/screenshot.mjs'), 'console.warn(\'Warning: ready selector ".shell" not found, capturing anyway.\');');
    git(root, ['add', 'docs/screenshots/screenshot.mjs']);
    git(root, ['commit', '-qm', 'Historical renderer']);
    git(root, ['tag', 'v2.20.1']);
    const next = git(root, ['rev-parse', 'HEAD']);
    const warning = await backfill({ ...settings, output: join(root, 'warning-results'), inventory: {
        ...inventory, throughCommit: next, releases: [{ ...inventory.releases[0], tag: 'v2.20.1', commit: next }],
    } });
    assert.equal(warning.results[0].status, 'failed');
    assert.match(warning.results[0].error, /skipped page readiness/);
});

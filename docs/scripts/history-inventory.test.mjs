import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectInventory, git, options, writeInventory } from './history-inventory.mjs';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'book-inventory-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    git(root, ['init', '-q', '--initial-branch=main']);
    git(root, ['config', 'user.name', 'juscghwe']);
    git(root, ['config', 'user.email', '62502225+juscghwe@users.noreply.github.com']);
    function commit(file, text) {
        mkdirSync(join(root, file, '..'), { recursive: true });
        writeFileSync(join(root, file), text);
        git(root, ['add', '.']);
        git(root, ['commit', '-qm', 'Fixture']);
        return git(root, ['rev-parse', 'HEAD']);
    }
    const first = commit('docs/book.toml', '[book]\ntitle = "Historical"\n');
    git(root, ['tag', '-a', 'v2.20.0', '-m', 'Annotated release']);
    commit('README.md', 'Second release');
    git(root, ['tag', 'v2.20.1']);
    const last = commit('README.md', 'Third release');
    git(root, ['tag', 'v2.20.2']);
    git(root, ['checkout', '-q', '--orphan', 'versions']);
    git(root, ['rm', '-rfq', '.']);
    const record = channels => JSON.stringify({ schema: 1, channels: { stable: channels } });
    const oldRecord = commit('versions.json', record({ frontend: ['2.20.0'], backend: ['2.20.0'] }));
    const newRecord = commit('versions.json', record({ frontend: ['2.20.1'], backend: ['2.20.2'] }));
    git(root, ['checkout', '-q', 'main']);
    return { root, first, last, oldRecord, newRecord };
}

test('inventory resolves annotated tags and recovers evicted image versions independently for each component', t => {
    const f = fixture(t);
    const result = collectInventory(f.root, { versionsRef: 'versions' });
    assert.equal(result.throughCommit, f.last);
    assert.equal(result.publicationsCommit, f.newRecord);
    assert.deepEqual(result.releases.map(r => r.tag), ['v2.20.0', 'v2.20.1', 'v2.20.2']);
    assert.equal(result.releases[0].commit, f.first);
    assert.deepEqual(result.releases[0].images, {
        frontend: { version: '2.20.0', recordedAt: f.oldRecord }, backend: { version: '2.20.0', recordedAt: f.oldRecord },
    });
    assert.equal(result.releases[1].images.backend, null);
    assert.equal(result.releases[2].images.frontend, null);
    assert(result.releases.every(r => r.hasBook));
    const output = join(f.root, 'output/inventory.json');
    writeInventory(output, result);
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), result);
});

test('inventory respects the selected history boundary and fails on unavailable publication evidence', t => {
    const f = fixture(t);
    assert.equal(collectInventory(f.root, { to: 'v2.20.1', versionsRef: 'versions' }).releases.length, 2);
    assert.throws(() => collectInventory(f.root, { versionsRef: 'missing' }));
    assert.throws(() => collectInventory(f.root, { from: '--bad-ref', versionsRef: 'versions' }), /stable/);
});

test('CLI rejects unknown, repeated and incomplete arguments', () => {
    assert.deepEqual(options(['--from', 'v2.20.0'], ['from']), { from: 'v2.20.0' });
    for (const args of [['--unknown', 'x'], ['--from'], ['--from', 'x', '--from', 'y']]) {
        assert.throws(() => options(args, ['from']), /invalid argument/);
    }
});

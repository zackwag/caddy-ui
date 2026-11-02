import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { preprocess, renderTree, repositoryFiles } from './project-structure.mjs';

test('tree groups directories first and preserves path-specific annotations', () => {
    const tree = renderTree(['README.md', 'backend/src/app.js', 'frontend/src/app.js', 'backend/src/app.js'], {
        'backend/': 'API', 'backend/src/app.js': 'backend only',
    });
    assert.ok(tree.indexOf('backend/') < tree.indexOf('README.md'));
    assert.match(tree, /backend\/  ← API/);
    assert.equal(tree.match(/backend only/g).length, 1);
    assert.equal(tree.match(/app\.js/g).length, 2);
});

test('stale annotations are retained without inventing deleted paths', () => {
    const notes = { 'removed.js': 'keep for a future restoration', 'active.js': 'active note' };
    const before = JSON.stringify(notes);
    assert.doesNotMatch(renderTree(['active.js'], notes), /removed/);
    assert.match(renderTree(['active.js', 'removed.js'], notes), /future restoration/);
    assert.equal(JSON.stringify(notes), before);
});

test('newlines and backticks in labels cannot break the generated code fence', () => {
    const tree = renderTree(['file```name.js'], { 'file```name.js': 'first\nsecond' });
    assert.ok(tree.startsWith('````text\n'));
    assert.match(tree, /first second/);
});

test('invalid annotations fail with a useful error', () => {
    for (const notes of [null, [], { file: 42 }]) {
        assert.throws(() => renderTree(['file'], notes), /map repository paths to strings/);
    }
});

test('builds reflect added/deleted files and preserve authored prose and annotation bytes', t => {
    const root = mkdtempSync(join(tmpdir(), 'caddy-ui-tree-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'docs'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, '.gitignore'), 'node_modules/\ndocs/book/\n');
    writeFileSync(join(root, 'old.js'), '');
    execFileSync('git', ['add', '.'], { cwd: root });
    writeFileSync(join(root, 'new.js'), '');
    rmSync(join(root, 'old.js'));
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'node_modules', 'ignored.js'), '');
    mkdirSync(join(root, 'docs', 'book'));
    writeFileSync(join(root, 'docs', 'book', 'ignored.html'), '');
    const notesPath = join(root, 'docs', 'project-structure-notes.json');
    const noteBytes = '{\n    "new.js": "new note",\n    "old.js": "stored note"\n}\n';
    writeFileSync(notesPath, noteBytes);
    const files = repositoryFiles(root);
    assert.ok(files.includes('new.js'));
    assert.ok(!files.includes('old.js'));
    assert.ok(!files.some(path => path.includes('ignored')));
    // mdBook 0.5 uses items; 0.4 used sections. Nested chapters share the schema.
    for (const key of ['items', 'sections']) {
        const chapter = { content: 'Authored intro\n{{#project-structure}}\nAuthored notes', sub_items: [] };
        const book = { [key]: ['Separator', { Chapter: { content: 'Parent', sub_items: [{ Chapter: chapter }] } }] };
        preprocess({ root: join(root, 'docs') }, book);
        assert.match(chapter.content, /Authored intro[\s\S]*new\.js  ← new note[\s\S]*Authored notes/);
        assert.doesNotMatch(chapter.content, /old\.js|\{\{#project-structure\}\}/);
        assert.equal(readFileSync(notesPath, 'utf8'), noteBytes);
    }
});

test('preprocessor advertises only its supported renderer', () => {
    const script = new URL('./project-structure.mjs', import.meta.url);
    assert.equal(spawnSync(process.execPath, [script.pathname, 'supports', 'html']).status, 0);
    assert.equal(spawnSync(process.execPath, [script.pathname, 'supports', 'pdf']).status, 1);
});

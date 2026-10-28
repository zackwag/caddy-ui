import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { preprocess, renderReleaseTable } from './release-table.mjs';

const changelog = `# Changelog

## [Unreleased]

* not published

## [2.0.0](https://github.com/zackwag/caddy-ui/compare/v1.18.0...v2.0.0) (2026-10-27)

### ⚠ BREAKING CHANGES

* **config:** support \`one|two\` ([#42](https://github.com/zackwag/caddy-ui/issues/42))

### Bug Fixes

* preserve $& and escaped \\| pipes
  with a continuation

## [1.18.0](https://github.com/zackwag/caddy-ui/compare/v1.17.0...v1.18.0) (2026-09-17)

### Features

* adopt release-please
`;

test('renders every published release in source order with dates, categories, links and safe table cells', () => {
    const table = renderReleaseTable(changelog.replaceAll('\n', '\r\n'));
    assert.equal(table.split('\n').length, 4);
    assert.match(table, /\[v2\.0\.0\]\(https:\/\/github.com\/zackwag\/caddy-ui\/compare\/v1\.18\.0\.\.\.v2\.0\.0\) \| 2026-10-27/);
    assert.match(table, /\*\*⚠ BREAKING CHANGES\*\*<br>• \*\*config:\*\* support `one\\\|two`/);
    assert.match(table, /\[#42\]\(https:\/\/github.com\/zackwag\/caddy-ui\/issues\/42\)/);
    assert.match(table, /\*\*Bug Fixes\*\*<br>• preserve \$& and escaped \\\| pipes<br>with a continuation/);
    assert.ok(table.indexOf('[v2.0.0]') < table.indexOf('[v1.18.0]'));
    assert.doesNotMatch(table, /Unreleased|not published/);
    assert.throws(() => renderReleaseTable('# Changelog\n'), /No release-please entries/);
});

test('book preprocessing reflects changelog updates without writing source files or changing legacy history', t => {
    const root = mkdtempSync(join(tmpdir(), 'caddy-ui-releases-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const docs = join(root, 'docs');
    mkdirSync(docs);
    const source = 'Authored introduction\n{{#release-table}}\n| `v1.17` | Preserved legacy summary |';
    writeFileSync(join(docs, 'releases.md'), source);
    writeFileSync(join(root, 'CHANGELOG.md'), changelog);
    for (const key of ['items', 'sections']) {
        const chapter = { content: source, sub_items: [] };
        const book = { [key]: ['Separator', { Chapter: { content: 'Parent', sub_items: [{ Chapter: chapter }] } }] };
        preprocess({ root: docs }, book);
        assert.ok(chapter.content.startsWith('Authored introduction\n| Version |'));
        assert.ok(chapter.content.endsWith('| `v1.17` | Preserved legacy summary |'));
        assert.match(chapter.content, /preserve \$&/);
        assert.doesNotMatch(chapter.content, /\{\{#release-table\}\}/);
    }
    writeFileSync(join(root, 'CHANGELOG.md'), changelog.replace('adopt release-please', 'updated release notes'));
    const book = { items: [{ Chapter: { content: source } }] };
    preprocess({ root: docs }, book);
    assert.match(book.items[0].Chapter.content, /updated release notes/);
    assert.equal(readFileSync(join(docs, 'releases.md'), 'utf8'), source);
});

test('preprocessor CLI supports HTML and reports missing changelog input as a build failure', () => {
    const script = fileURLToPath(new URL('./release-table.mjs', import.meta.url));
    assert.equal(spawnSync(process.execPath, [script, 'supports', 'html']).status, 0);
    assert.equal(spawnSync(process.execPath, [script, 'supports', 'pdf']).status, 1);
    const result = spawnSync(process.execPath, [script], {
        input: JSON.stringify([{ root: '/nonexistent/docs' }, { items: [{ Chapter: { content: '{{#release-table}}' } }] }]),
        encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Release table: .*CHANGELOG\.md/);
    assert.equal(result.stdout, '');
});

test('the repository changelog contributes one table row per release', () => {
    const source = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
    const table = renderReleaseTable(source);
    assert.equal(table.split('\n').length - 2, [...source.matchAll(/^## \[/gm)].length);
});

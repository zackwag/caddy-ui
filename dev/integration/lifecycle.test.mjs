import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { FixtureScope } from './lifecycle.mjs';

test('test timeout disposes an acquisition that completes after cancellation', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-ui-cancellation-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const entry = join(directory, 'cancelled-test.mjs');
    const disposed = join(directory, 'disposed');
    await writeFile(entry, `import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { FixtureScope } from ${JSON.stringify(new URL('./lifecycle.mjs', import.meta.url).href)};
test('cancel during acquisition', { timeout: 20 }, async t => {
    const scope = new FixtureScope(t.signal);
    t.after(() => scope.close());
    await scope.acquire(() => new Promise(resolve => setTimeout(() => resolve('late-resource'), 100)),
        value => writeFile(${JSON.stringify(disposed)}, value));
});
`);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    await assert.rejects(promisify(execFile)(process.execPath, ['--test', entry], { timeout: 5000, env }),
        error => error.code === 1 && /test timed out/.test(error.stdout));
    assert.equal(await readFile(disposed, 'utf8'), 'late-resource');
});

test('cancellation waits for an in-flight mutation before purging its resources', async () => {
    const cancellation = new AbortController();
    const scope = new FixtureScope(cancellation.signal);
    const events = [];
    scope.defer(() => events.push('purge'));
    let finish;
    const mutation = scope.run(() => new Promise(resolve => { finish = resolve; }));
    await Promise.resolve();
    const failure = new Error('cancelled');
    cancellation.abort(failure);
    const rejected = assert.rejects(mutation, error => error === failure);
    assert.deepEqual(events, []);
    events.push('created');
    finish();
    await rejected;
    await scope.close();
    assert.deepEqual(events, ['created', 'purge']);
    await assert.rejects(scope.run(() => events.push('unexpected')), error => error === failure);
});

test('cleanup attempts every layer once and preserves all failures', async () => {
    const scope = new FixtureScope();
    const events = [];
    scope.defer(() => events.push('directory'));
    const failure = new Error('purge failed');
    scope.defer(() => { events.push('containers'); throw failure; });
    scope.defer(() => events.push('backend'));
    const closing = scope.close();
    assert.equal(scope.close(), closing);
    await assert.rejects(closing, error => error instanceof AggregateError && error.errors[0] === failure);
    assert.deepEqual(events, ['backend', 'containers', 'directory']);
});

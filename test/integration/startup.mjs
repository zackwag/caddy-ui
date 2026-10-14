import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Harness } from '../../scripts/dev-caddy/harness.mjs';
import { useTestStack } from './stack.mjs';

test('failed backend startup still removes its Caddy containers and volumes', { timeout: 60000 }, async t => {
    const project = randomBytes(8).toString('hex');
    await assert.rejects(useTestStack(t, { project, backendEntry: 'nonexistent-integration-entry.mjs' }), error => {
        assert.match(error.message, /Backend exited \(1\) before readiness/);
        assert.match(error.message, /MODULE_NOT_FOUND/);
        assert.doesNotMatch(error.message, /Readiness timeout/);
        return true;
    });
    const harness = new Harness(project);
    assert.deepEqual(await harness.names(), []);
    assert.deepEqual(await harness.names('volume'), []);
});

test('real backend bind failure reports EADDRINUSE and cleans up its Caddy resources', { timeout: 60000 }, async t => {
    const project = randomBytes(8).toString('hex');
    const directory = await mkdtemp(join(tmpdir(), 'caddy-ui-port-collision-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const entry = join(directory, 'occupied-port.mjs');
    // Force a fixed-port collision independently of the fixture's PORT=0 default.
    await writeFile(entry, `import { createServer } from 'node:net';
const blocker = createServer();
await new Promise(resolve => blocker.listen(Number(process.env.PORT), '127.0.0.1', resolve));
process.env.PORT = String(blocker.address().port);
await import(${JSON.stringify(new URL('../../backend/src/index.js', import.meta.url).href)});
`);
    await assert.rejects(useTestStack(t, { project, backendEntry: entry }), error => {
        assert.match(error.message, /Backend exited \(1\) before readiness/);
        assert.match(error.message, /EADDRINUSE/);
        assert.doesNotMatch(error.message, /Readiness timeout/);
        assert.doesNotMatch(error.message, /Caddy UI backend running/);
        return true;
    });
    const harness = new Harness(project);
    assert.deepEqual(await harness.names(), []);
    assert.deepEqual(await harness.names('volume'), []);
});

test('concurrent real backends own distinct OS-assigned ports', { timeout: 60000 }, async t => {
    const results = await Promise.allSettled([useTestStack(t), useTestStack(t)]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    const [first, second] = results.map(result => result.value);
    assert.notEqual(new URL(first.url).port, new URL(second.url).port);
    const versions = await Promise.all([first.api('/version'), second.api('/version')]);
    assert(versions.every(response => response.status === 200));
    assert.notEqual(versions[0].data.version, versions[1].data.version);
    await Promise.all([first.close(), second.close()]);
    for (const stack of [first, second]) {
        assert.deepEqual(await stack.harness.names(), []);
        assert.deepEqual(await stack.harness.names('volume'), []);
    }
});

test('cancellation during backend startup kills the child and purges Caddy resources', { timeout: 60000 }, async t => {
    const project = randomBytes(8).toString('hex');
    const directory = await mkdtemp(join(tmpdir(), 'caddy-ui-cancel-startup-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const entry = join(directory, 'pending-backend.mjs');
    const marker = join(directory, 'pid');
    await writeFile(entry, `import { writeFile } from 'node:fs/promises';
await writeFile(${JSON.stringify(marker)}, String(process.pid));
setInterval(() => {}, 1000);
`);
    const cancellation = new AbortController();
    const started = useTestStack(t, { project, backendEntry: entry, signal: cancellation.signal });
    t.after(async () => {
        cancellation.abort();
        await started.then(stack => stack.close(), () => {});
    });
    let pid;
    for (let attempt = 0; attempt < 200 && !pid; attempt++) {
        try { pid = Number(await readFile(marker, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!pid) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(pid, 'Fixture backend did not start');
    const reason = new Error('cancelled during startup');
    cancellation.abort(reason);
    await assert.rejects(started, error => error.cause === reason);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    const harness = new Harness(project);
    assert.deepEqual(await harness.names(), []);
    assert.deepEqual(await harness.names('volume'), []);
});

test('fixture refuses a namespace already used by another test stack', { timeout: 60000 }, async t => {
    const stack = await useTestStack(t);
    await assert.rejects(useTestStack(t, { project: stack.harness.project }), /fresh, empty Docker namespace/);
    assert.equal((await stack.harness.inspect('container', stack.harness.resource('alpha'))).State.Running, true);
    assert.equal((await stack.api('/caddyfile')).status, 200);
});

test('simultaneous fixtures claim a namespace exclusively until cleanup completes', { timeout: 60000 }, async t => {
    const project = randomBytes(8).toString('hex');
    const results = await Promise.allSettled([useTestStack(t, { project }), useTestStack(t, { project })]);
    const successes = results.filter(result => result.status === 'fulfilled');
    const failures = results.filter(result => result.status === 'rejected');
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    assert.match(failures[0].reason.message, /another fixture already holds its lease/);
    const stack = successes[0].value;
    assert.equal((await stack.api('/caddyfile')).status, 200);
    assert.equal((await stack.harness.inspect('container', stack.harness.resource('alpha'))).State.Running, true);
    assert(await stack.harness.inspect('volume', stack.harness.resource('alpha')));
    await stack.close();
    assert.deepEqual(await stack.harness.names(), []);
    assert.deepEqual(await stack.harness.names('volume'), []);
    // A completed cleanup releases the lease, allowing explicit namespace reuse.
    const next = await useTestStack(t, { project });
    assert.equal((await next.api('/caddyfile')).status, 200);
});

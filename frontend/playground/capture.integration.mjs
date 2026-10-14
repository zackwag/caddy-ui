import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { Harness } from '../../scripts/dev-caddy/harness.mjs';
import { captureDashboard } from './capture.mjs';
import { sourceFingerprint } from './capture-source.mjs';

async function assertClean(scope) {
    assert.deepEqual(await scope.names(), []);
    assert.deepEqual(await scope.names('volume'), []);
}

test('capture real Dashboard states, retain no resources and leave unrelated instances untouched', { timeout: 60000 }, async t => {
    const directory = await mkdtemp(resolve(tmpdir(), 'preview-capture-check-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const unrelated = new Harness(randomBytes(8).toString('hex'));
    t.after(() => unrelated.removeAll({ confirmed: true, purge: true }));
    await unrelated.create('sentinel');
    const container = await unrelated.inspect('container', unrelated.resource('sentinel'));
    const volume = await unrelated.inspect('volume', unrelated.resource('sentinel'));
    let scope;
    const output = resolve(directory, 'dashboard.json');
    const capture = await captureDashboard({ output, onNamespace: project => { scope = new Harness(project); } });
    assert.equal(capture.source.sourceHash, await sourceFingerprint());
    assert.deepEqual(capture.scenarios.map(scenario => scenario.id), ['dashboard-online', 'dashboard-empty', 'dashboard-stopped']);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), capture);
    await assertClean(scope);
    const retained = await unrelated.inspect('container', unrelated.resource('sentinel'));
    assert.equal(retained.Id, container.Id);
    assert.equal(retained.State.Running, true);
    assert.deepEqual(await unrelated.inspect('volume', unrelated.resource('sentinel')), volume);
});

test('failed backend startup keeps the previous artifact and removes capture resources', { timeout: 60000 }, async t => {
    const directory = await mkdtemp(resolve(tmpdir(), 'preview-capture-failure-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const output = resolve(directory, 'dashboard.json');
    await writeFile(output, 'previous artifact');
    let scope;
    await assert.rejects(captureDashboard({ output, backendEntry: resolve(directory, 'missing-backend.mjs'),
        onNamespace: project => { scope = new Harness(project); } }), error => {
        assert.match(error.cause.message, /Capture backend exited/);
        return true;
    });
    assert.equal(await readFile(output, 'utf8'), 'previous artifact');
    await assertClean(scope);
});

test('interrupting capture cleans up its own resources without publishing an artifact', { timeout: 60000 }, async t => {
    const directory = await mkdtemp(resolve(tmpdir(), 'preview-capture-interrupt-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const output = resolve(directory, 'dashboard.json');
    const child = spawn(process.execPath, [resolve(import.meta.dirname, 'capture.mjs'), output], { stdio: 'pipe' });
    let log = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log += data; });
    const closed = new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await closed; }
    });
    const deadline = Date.now() + 15000;
    let scope;
    while (Date.now() < deadline) {
        const namespace = log.match(/Capture owns Docker namespace ([a-f0-9]{16})/);
        if (namespace) scope = new Harness(namespace[1]);
        if (scope && (await scope.names()).length) break;
        assert.equal(child.exitCode, null, log);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(scope, log);
    child.kill('SIGTERM');
    assert.equal(await closed, 1, log);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
    await assertClean(scope);
});

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { docker, LABEL } from '../../scripts/dev-caddy/harness.mjs';
import { captureDashboard } from './capture.mjs';
import { sourceFingerprint } from './capture-source.mjs';

async function resources() {
    return {
        containers: (await docker(['ps', '-aq', '--no-trunc', '--filter', `label=${LABEL}=true`])).split('\n').filter(Boolean).sort(),
        volumes: (await docker(['volume', 'ls', '-q', '--filter', `label=${LABEL}=true`])).split('\n').filter(Boolean).sort(),
    };
}

test('capture real Dashboard states and retain no resources', { timeout: 60000 }, async t => {
    const directory = await mkdtemp(resolve(tmpdir(), 'preview-capture-check-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const before = await resources();
    const output = resolve(directory, 'dashboard.json');
    const capture = await captureDashboard({ output });
    assert.equal(capture.source.sourceHash, await sourceFingerprint());
    assert.deepEqual(capture.scenarios.map(scenario => scenario.id), ['dashboard-online', 'dashboard-empty', 'dashboard-stopped']);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), capture);
    assert.deepEqual(await resources(), before);
});

test('failed backend startup keeps the previous artifact and removes capture resources', { timeout: 60000 }, async t => {
    const directory = await mkdtemp(resolve(tmpdir(), 'preview-capture-failure-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const output = resolve(directory, 'dashboard.json');
    await writeFile(output, 'previous artifact');
    const before = await resources();
    await assert.rejects(captureDashboard({ output, backendEntry: resolve(directory, 'missing-backend.mjs') }), error => {
        assert.match(error.cause.message, /Capture backend exited/);
        return true;
    });
    assert.equal(await readFile(output, 'utf8'), 'previous artifact');
    assert.deepEqual(await resources(), before);
});

test('interrupting capture cleans up its own resources without publishing an artifact', { timeout: 60000 }, async t => {
    const directory = await mkdtemp(resolve(tmpdir(), 'preview-capture-interrupt-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const output = resolve(directory, 'dashboard.json');
    const before = await resources();
    const child = spawn(process.execPath, [resolve(import.meta.dirname, 'capture.mjs'), output], { stdio: 'pipe' });
    let log = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log += data; });
    const closed = new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await closed; }
    });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if ((await resources()).containers.some(id => !before.containers.includes(id))) break;
        assert.equal(child.exitCode, null, log);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    child.kill('SIGTERM');
    assert.equal(await closed, 1, log);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
    assert.deepEqual(await resources(), before);
});

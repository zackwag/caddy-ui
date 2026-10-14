import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Harness, checkDocker } from '../../scripts/dev-caddy/harness.mjs';

test('interrupted collection removes its resources and preserves an unrelated fixture', { timeout: 120000 }, async t => {
    await checkDocker();
    const sentinel = new Harness(randomBytes(8).toString('hex'));
    let child, done, directory;
    t.after(async () => {
        try {
            if (child && child.exitCode === null && child.signalCode === null) {
                child.kill('SIGTERM');
                const force = setTimeout(() => child.kill('SIGKILL'), 8000);
                try { await done; } finally { clearTimeout(force); }
            }
        } finally {
            await sentinel.removeAll({ confirmed: true, purge: true });
            if (directory) await rm(directory, { recursive: true, force: true });
        }
    });
    await sentinel.create('sentinel');
    const before = await sentinel.inspect('container', sentinel.resource('sentinel'));
    directory = await mkdtemp(join(tmpdir(), 'etoe-cancellation-'));
    const output = join(directory, 'experiment');
    child = spawn(process.execPath, [resolve(import.meta.dirname, 'run.mjs'), '--trials', '1', '--profiles', 'slow-style', '--scope', 'recovery', '--output', output],
        { cwd: resolve(import.meta.dirname, '../..'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
    done = once(child, 'exit');
    let project;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        const trial = join(output, '001-slow-style');
        for (const entry of await readdir(trial, { withFileTypes: true }).catch(() => [])) if (entry.isDirectory()) {
            const ownership = JSON.parse(await readFile(join(trial, entry.name, 'ownership.json'), 'utf8'));
            const harness = new Harness(ownership.project);
            const containers = await harness.names();
            if (containers.length && (await harness.inspect('container', harness.resource(containers[0])))?.State.Running) { project = ownership.project; break; }
        }
        if (project) break;
        if (child.exitCode !== null) assert.fail('Collection exited before acquisition: ' + log + '\n' + await readFile(join(trial, 'test.log'), 'utf8').catch(() => 'no test log'));
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(project, 'Collection should acquire a real owned container');
    child.kill('SIGTERM');
    const [code] = await done;
    assert.notEqual(code, 0, log);
    const harness = new Harness(project);
    assert.deepEqual(await harness.names(), []);
    assert.deepEqual(await harness.names('volume'), []);
    assert.equal(await harness.run(['ps', '-aq', '--filter', `name=^/caddy-ui-test-${project}-lease$`]), '');
    const after = await sentinel.inspect('container', sentinel.resource('sentinel'));
    assert.equal(after.Id, before.Id);
    assert.equal(after.State.Running, true);
    const experiment = JSON.parse(await readFile(join(output, 'experiment.json'), 'utf8'));
    assert.equal(experiment.interrupted, true);
});

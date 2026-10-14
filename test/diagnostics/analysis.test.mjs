import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeEvidence, netlogEvents, wilson, summarize } from './analysis.mjs';
import { options, schedule, cleanupTrial } from './run.mjs';
import { cleanupNamespace } from './cleanup.mjs';
import { IMAGE } from '../../scripts/dev-caddy/harness.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('NetLog clock conversion keeps raw indexes and error -21 evidence', () => {
    const events = netlogEvents({ constants: { timeTickOffset: '1000', logEventTypes: { NETWORK_IP_ADDRESSES_CHANGED: 7, REQUEST_ALIVE: 8 } },
        events: [{ type: 7, time: '20', source: { id: 1 } }, { type: 8, time: '22', params: { net_error: -21 } }, { type: 8, time: '23' }] });
    assert.equal(events.length, 2);
    assert.equal(events[0].epoch, 1020);
    assert.equal(events[1].index, 1);
    assert.equal(events[1].error, -21);
});

test('network attribution needs the owned interface, matching time and Chromium evidence', () => {
    const input = { metadata: { interface: { index: 42, name: 'veth-owned' } },
        timeline: [{ index: 0, type: 'request-failed', epoch: 1050, error: 'net::ERR_NETWORK_CHANGED' }],
        system: [{ index: 3, type: 'kernel', epoch: 1000, line: '42: veth-owned inet6 fe80::1/64 scope link' }],
        netlog: [{ index: 6, epoch: 1020, name: 'NETWORK_IP_ADDRESSES_CHANGED' }, { index: 7, epoch: 1040, error: -21 }] };
    assert.equal(analyzeEvidence(input).findings[0].correlations.length, 1);
    assert.equal(analyzeEvidence({ ...input, metadata: { interface: { index: 43, name: 'foreign' } } }).findings[0].correlations.length, 0);
    assert.equal(analyzeEvidence({ ...input, netlog: [{ index: 6, epoch: 5000, name: 'NETWORK_IP_ADDRESSES_CHANGED' }] }).findings[0].correlations.length, 0);
    assert.equal(analyzeEvidence({ ...input, timeline: [] }).findings.length, 0);
});

const toastTimeline = [
    { index: 0, type: 'dom', event: 'toast-added', document: 1, toast: 1, epoch: 1000 },
    { index: 1, type: 'dom', event: 'toast-removed', document: 1, toast: 1, epoch: 7000 },
    { index: 2, type: 'dom', event: 'load', document: 1, epoch: 9000 },
];
test('toast rule correlates one document and toast across their normal lifetime', () => {
    const evidence = analyzeEvidence({ timeline: toastTimeline });
    assert.equal(evidence.missedToasts, 1);
    assert.deepEqual(evidence.findings[0].evidence[0], { added: 0, removed: 1, load: 2, lifetimeMs: 6000, loadAfterRemovalMs: 2000 });
});
test('early recovery, other documents and load-before-removal do not count as expiry races', () => {
    for (const patch of [{ epoch: 3000 }, { document: 2 }, { toast: 2 }]) {
        assert.equal(analyzeEvidence({ timeline: toastTimeline.map((event, index) => index === 1 ? { ...event, ...patch } : event) }).missedToasts, 0);
    }
    assert.equal(analyzeEvidence({ timeline: toastTimeline.map((event, index) => index === 2 ? { ...event, epoch: 4000 } : event) }).missedToasts, 0);
});
test('zero failures produce a nonzero Wilson upper bound', () => {
    const interval = wilson(0, 100);
    assert.equal(interval.rate, 0);
    assert.ok(interval.upper > 0.03 && interval.upper < 0.04);
    assert.equal(wilson(0, 0), null);
});
test('controlled profiles are not pooled with ordinary trials and recovered events stay visible', () => {
    const rows = summarize([{ profile: 'normal', exitCode: 0, evidence: [{ networkInterruptions: 2, missedToasts: 0 }] },
        { profile: 'slow-style', exitCode: 1, evidence: [{ networkInterruptions: 0, missedToasts: 1 }] }]);
    assert.equal(rows[0].failed, 0);
    assert.equal(rows[0].passingWithInterruptions, 1);
    assert.equal(rows[1].failed, 1);
});
test('input limits reject unknown profiles, flags and unbounded run counts', () => {
    for (const args of [['--trials', '21'], ['--trials', '-1'], ['--profiles', 'fake'], ['--seed', '999999999999'], ['--scope', 'other'], ['--unknown', 'x']]) {
        assert.throws(() => options(args));
    }
    assert.equal(options(['--trials', '2']).trials, 2);
});
test('interrupted and unsupported controls are not reported as successful or failed measurements', () => {
    const rows = summarize([{ profile: 'normal', interrupted: true, exitCode: -1, evidence: [] },
        { profile: 'normal', exitCode: 1, evidence: [] }, { profile: 'settled-network', unavailable: true, exitCode: 1, evidence: [] }]);
    assert.equal(rows[0].eligible, 1);
    assert.equal(rows[0].incomplete, 1);
    assert.equal(rows[0].failed, 1);
    assert.equal(rows[1].interval, null);
});
test('seeded scheduling balances every profile and is repeatable', () => {
    const config = options(['--trials', '5']);
    const list = schedule(config);
    assert.deepEqual(list, schedule(config));
    assert.equal(list.length, 20);
    for (const profile of ['normal', 'slow-style', 'settled-network', 'localhost']) assert.equal(list.filter(trial => trial.profile === profile).length, 5);
});

test('an altered ownership manifest cannot direct cleanup at another namespace', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'etoe-diagnostics-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await mkdir(join(directory, 'case'));
    await writeFile(join(directory, 'case/ownership.json'), JSON.stringify({ name: 'scenario', project: 'a'.repeat(16) }));
    let calls = 0;
    await assert.rejects(cleanupTrial(directory, 'fresh-nonce', async () => { calls++; return ''; }), /manifest/);
    assert.equal(calls, 0);
});

test('cleanup refuses an unrelated lease even when its container name matches', async () => {
    const project = 'a'.repeat(16);
    const commands = [];
    const run = async args => {
        commands.push(args);
        if (args.includes(`name=^/caddy-ui-test-${project}-lease$`)) return 'lease-id';
        if (args[1] === 'inspect') return JSON.stringify([{ Name: `/caddy-ui-test-${project}-lease`, Id: 'lease-id',
            Config: { Image: IMAGE, Labels: { 'io.caddy-ui.test-fixture': 'true', 'io.caddy-ui.test-project': 'b'.repeat(16) } },
            HostConfig: { NetworkMode: 'none' }, Mounts: [] }]);
        return '';
    };
    await assert.rejects(cleanupNamespace(project, run), /ownership mismatch/);
    assert.ok(!commands.some(args => args[0] === 'rm'));
});

test('cleanup verifies a fixture lease before removing that exact resource', async () => {
    const project = 'a'.repeat(16);
    let removed = false;
    const commands = [];
    const run = async args => {
        commands.push(args);
        if (args.includes(`name=^/caddy-ui-test-${project}-lease$`)) return removed ? '' : 'lease-id';
        if (args[1] === 'inspect') return JSON.stringify([{ Name: `/caddy-ui-test-${project}-lease`, Id: 'lease-id',
            Config: { Image: IMAGE, Labels: { 'io.caddy-ui.test-fixture': 'true', 'io.caddy-ui.test-project': project } },
            HostConfig: { NetworkMode: 'none' }, Mounts: [] }]);
        if (args[0] === 'rm') removed = true;
        return '';
    };
    const result = await cleanupNamespace(project, run);
    assert.equal(result.project, project);
    assert.deepEqual(commands.filter(args => args[0] === 'rm'), [['rm', 'lease-id']]);
    assert.ok(!commands.some(args => args.includes('prune')));
});

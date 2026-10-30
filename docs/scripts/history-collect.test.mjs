import assert from 'node:assert/strict';
import test from 'node:test';
import { collectHistory } from './history-collect.mjs';

const repository = 'juscghwe/caddy-ui';
const dispatch = JSON.stringify({ workflow_run_id: 42 });
const run = overrides => ({ id: 42, event: 'workflow_dispatch', head_branch: 'main',
    status: 'completed', conclusion: 'success', ...overrides });
const silent = { repository, notify: () => {} };

test('collection dispatches once and polls only the returned run ID', async () => {
    const calls = [], messages = [];
    const responses = ['queued', 'in_progress', 'completed'].map(status => run({ status }));
    let pauses = 0;
    const id = await collectHistory({ repository, notify: message => messages.push(message),
        sleep: async () => { pauses++; }, execute: async (command, args, options) => {
            calls.push({ command, args });
            assert.equal(options.timeout, 30000);
            assert(options.signal instanceof AbortSignal);
            return { stdout: args.includes('POST') ? dispatch : JSON.stringify(responses.shift()) };
        } });
    assert.equal(id, 42);
    assert.equal(pauses, 2);
    assert.equal(calls.filter(call => call.args.includes('POST')).length, 1);
    assert.deepEqual(calls[0], { command: 'gh', args: ['api', '--method', 'POST',
        'repos/juscghwe/caddy-ui/actions/workflows/docs.yml/dispatches', '-f', 'ref=main',
        '-f', 'inputs[archive_history]=true', '-F', 'return_run_details=true'] });
    assert(calls.slice(1).every(call => call.args[1] === 'repos/juscghwe/caddy-ui/actions/runs/42'));
    assert(messages.at(-1).includes('https://github.com/juscghwe/caddy-ui/actions/runs/42'));
});

test('ambiguous or invalid dispatch responses never cause a second dispatch', async () => {
    for (const response of ['', '{}', '{"workflow_run_id":0}', '{"workflow_run_id":"42"}', '{"workflow_run_id":-1}']) {
        let calls = 0;
        await assert.rejects(collectHistory({ ...silent, execute: async () => {
            calls++;
            return { stdout: response };
        } }));
        assert.equal(calls, 1);
    }
});

test('mismatched run IDs, foreign events/branches and invalid run statuses stop publication', async () => {
    for (const invalid of [null, run({ id: 43 }), run({ event: 'push' }), run({ head_branch: 'feature' }), run({ status: 'unknown' })]) {
        await assert.rejects(collectHistory({ ...silent, execute: async (command, args) => ({
            stdout: args.includes('POST') ? dispatch : JSON.stringify(invalid),
        }) }), /Invalid dispatched archive workflow run/);
    }
});

test('failed, cancelled or skipped fork runs stop publication', async () => {
    for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', null]) {
        await assert.rejects(collectHistory({ ...silent, execute: async (command, args) => ({
            stdout: args.includes('POST') ? dispatch : JSON.stringify(run({ conclusion })),
        }) }), /Archive collection .*https:\/\/github.com\/juscghwe\/caddy-ui\/actions\/runs\/42/);
    }
});

test('an ambiguous dispatch error is never retried', async () => {
    let calls = 0;
    await assert.rejects(collectHistory({ ...silent, execute: async () => {
        calls++; throw new Error('Dispatch denied');
    } }), /Dispatch denied/);
    assert.equal(calls, 1);
});

test('persistent lookup failures stop publication after four reads without redispatching', async () => {
    let dispatches = 0, polls = 0, pauses = 0;
    await assert.rejects(collectHistory({ ...silent, execute: async (command, args) => {
        if (!args.includes('POST')) {
            polls++;
            throw new Error('Run lookup denied');
        }
        dispatches++;
        return { stdout: dispatch };
    }, sleep: async () => { pauses++; } }), /Run lookup denied/);
    assert.equal(dispatches, 1);
    assert.equal(polls, 4);
    assert.equal(pauses, 3);
});

test('transient read failures retry the same run and a successful read resets the failure budget', async () => {
    const responses = [null, null, null, run({ status: 'in_progress' }), null, null, null, run()];
    let dispatches = 0, polls = 0, pauses = 0;
    assert.equal(await collectHistory({ ...silent, execute: async (command, args) => {
        if (args.includes('POST')) {
            dispatches++;
            return { stdout: dispatch };
        }
        assert.equal(args[1], 'repos/juscghwe/caddy-ui/actions/runs/42');
        polls++;
        const response = responses.shift();
        if (!response) throw new Error('Temporary API failure');
        return { stdout: JSON.stringify(response) };
    }, sleep: async () => { pauses++; } }), 42);
    assert.equal(dispatches, 1);
    assert.equal(polls, 8);
    assert.equal(pauses, 7);
});

test('cancellation interrupts a read retry without redispatching', async () => {
    let dispatches = 0, polls = 0;
    const controller = new AbortController();
    await assert.rejects(collectHistory({ ...silent, signal: controller.signal,
        execute: async (command, args) => {
            if (args.includes('POST')) {
                dispatches++;
                return { stdout: dispatch };
            }
            polls++;
            throw new Error('Temporary API failure');
        }, sleep: async () => { controller.abort(new Error('Stopped')); },
    }), /Stopped/);
    assert.equal(dispatches, 1);
    assert.equal(polls, 1);
});

test('a pending run has a bounded wait without redispatching', async () => {
    let dispatches = 0;
    await assert.rejects(collectHistory({ ...silent, timeoutMs: 20, pollMs: 5, execute: async (command, args) => {
        if (args.includes('POST')) dispatches++;
        return { stdout: args.includes('POST') ? dispatch : JSON.stringify(run({ status: 'pending' })) };
    } }), /Timed out waiting/);
    assert.equal(dispatches, 1);
});

test('cancellation stops polling without redispatching', async () => {
    let dispatches = 0;
    const controller = new AbortController();
    await assert.rejects(collectHistory({ ...silent, signal: controller.signal,
        execute: async (command, args) => {
            if (args.includes('POST')) dispatches++;
            return { stdout: args.includes('POST') ? dispatch : JSON.stringify(run({ status: 'queued' })) };
        }, sleep: async () => { controller.abort(new Error('Stopped')); },
    }), /Stopped/);
    assert.equal(dispatches, 1);
});

test('invalid repository arguments fail before invoking GitHub', async () => {
    for (const invalid of ['../other', undefined]) {
        await assert.rejects(collectHistory({ repository: invalid,
            execute: async () => { assert.fail('Must not contact GitHub'); } }), /Expected/);
    }
});

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { trackObserver } from './observe.mjs';

function fixture(kill) {
    const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null });
    const signals = [], events = [];
    child.kill = signal => { signals.push(signal); kill?.(child, signal); return true; };
    const metadata = { observers: [], captureErrors: [] };
    const observer = trackObserver('docker', child, metadata, (type, data) => events.push({ type, ...data }));
    return { child, signals, events, metadata, observer };
}

function finish(child, code, signal = null) {
    child.exitCode = code; child.signalCode = signal;
    child.emit('exit', code, signal); child.emit('close', code, signal);
}

test('requested SIGTERM/143 shutdown is recorded without a false capture failure', async () => {
    const f = fixture(child => queueMicrotask(() => finish(child, 143)));
    await Promise.all([f.observer.stop(), f.observer.stop()]);
    assert.deepEqual(f.signals, ['SIGTERM']);
    assert.deepEqual(f.metadata.captureErrors, []);
    assert.equal(f.events.find(event => event.type === 'observer-exit').expected, true);
    assert.ok(f.metadata.observers[0].shutdownRequested);
    assert.ok(f.metadata.observers[0].closed);
});

test('an early exit remains a capture failure even for code zero or SIGTERM', async () => {
    for (const [code, signal] of [[1, null], [0, null], [null, 'SIGTERM']]) {
        const f = fixture();
        finish(f.child, code, signal);
        await f.observer.stop();
        assert.match(f.metadata.captureErrors[0], /exited unexpectedly/);
        assert.equal(f.events[0].expected, false);
        assert.deepEqual(f.signals, []);
    }
});

test('a spawn failure is retained without waiting for a nonexistent process', async () => {
    const f = fixture();
    f.child.pid = undefined;
    f.child.emit('error', new Error('command not found'));
    f.child.emit('close', -2);
    await f.observer.stop();
    assert.deepEqual(f.metadata.captureErrors, ['docker observer: command not found']);
    assert.deepEqual(f.signals, []);
});

test('forced teardown stays a capture warning and is not relabeled as expected exit', async () => {
    const f = fixture((child, signal) => { if (signal === 'SIGKILL') queueMicrotask(() => finish(child, null, signal)); });
    await f.observer.stop(5);
    assert.deepEqual(f.signals, ['SIGTERM', 'SIGKILL']);
    assert.deepEqual(f.metadata.captureErrors, ['docker observer required SIGKILL during teardown']);
    assert.equal(f.events.find(event => event.type === 'observer-exit').expected, false);
    assert.equal(f.metadata.observers[0].forced, true);
});

test('observer shutdown waits for pipe close after the process exits', async () => {
    const f = fixture(child => { child.exitCode = 143; child.emit('exit', 143, null); });
    let settled = false;
    const stopping = f.observer.stop().then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    f.child.emit('close', 143, null);
    await stopping;
    assert.equal(settled, true);
});

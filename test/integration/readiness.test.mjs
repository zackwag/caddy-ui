import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { waitForHttp, waitForBackendPort } from './stack.mjs';

async function endpoint(t, handler) {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
        server.closeAllConnections();
        return new Promise(resolve => server.close(resolve));
    });
    return `http://127.0.0.1:${server.address().port}/api/version`;
}

test('readiness retries transient failures and checks the fixture version', async t => {
    let requests = 0;
    const url = await endpoint(t, (req, res) => {
        requests++;
        res.writeHead(requests === 1 ? 503 : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: requests < 3 ? 'another-process' : 'fixture' }));
    });
    await waitForHttp(url, { accept: async response => response.ok && (await response.json()).version === 'fixture', timeoutMs: 5000 });
    assert.equal(requests, 3);
});

test('readiness exposes an already-known startup error directly', async () => {
    const failure = new Error('spawn failed');
    await assert.rejects(waitForHttp('http://127.0.0.1:1', { signal: AbortSignal.abort(failure) }), error => error === failure);
});

test('readiness aborts a pending fetch when the backend exits', { timeout: 5000 }, async t => {
    const startup = new AbortController();
    const failure = new Error('Backend exited (1) before readiness');
    const url = await endpoint(t, () => startup.abort(failure));
    await assert.rejects(waitForHttp(url, { signal: startup.signal }), error => error === failure);
});

test('startup failure is terminal even when the readiness predicate throws', { timeout: 5000 }, async t => {
    const startup = new AbortController();
    const failure = new Error('Backend exited (SIGTERM) before readiness');
    const url = await endpoint(t, (req, res) => res.end('ready'));
    await assert.rejects(waitForHttp(url, { accept: () => {
        startup.abort(failure);
        throw new Error('transient predicate error');
    }, signal: startup.signal }), error => error === failure);
});

test('readiness still times out when a live service never becomes ready', async t => {
    const url = await endpoint(t, (req, res) => { res.writeHead(503); res.end(); });
    await assert.rejects(waitForHttp(url, { timeoutMs: 200 }), /Readiness timeout/);
});

test('port handshake ignores unrelated messages and removes its listener', async () => {
    const backend = new EventEmitter();
    const port = waitForBackendPort(backend);
    backend.emit('message', { type: 'unrelated', port: 0 });
    backend.emit('message', { type: 'caddy-ui:listening', port: 43210 });
    assert.equal(await port, 43210);
    assert.equal(backend.listenerCount('message'), 0);
});

test('port handshake rejects invalid ports', async () => {
    for (const port of [0, -1, 65536, 1.5, '3001', undefined]) {
        const backend = new EventEmitter();
        const ready = waitForBackendPort(backend);
        backend.emit('message', { type: 'caddy-ui:listening', port });
        await assert.rejects(ready, /invalid listening port/);
        assert.equal(backend.listenerCount('message'), 0);
    }
});

test('port handshake aborts on startup failure before or after subscribing', async () => {
    for (const alreadyAborted of [true, false]) {
        const backend = new EventEmitter();
        const startup = new AbortController();
        const error = new Error('Backend exited (1) before readiness');
        if (alreadyAborted) startup.abort(error);
        const ready = waitForBackendPort(backend, { signal: startup.signal });
        if (!alreadyAborted) startup.abort(error);
        await assert.rejects(ready, actual => actual === error);
        assert.equal(backend.listenerCount('message'), 0);
    }
});

test('port handshake remains aborted when its reason is null', async () => {
    const backend = new EventEmitter();
    const startup = new AbortController();
    const ready = waitForBackendPort(backend, { signal: startup.signal });
    startup.abort(null);
    await assert.rejects(ready, reason => reason === null);
    assert.equal(backend.listenerCount('message'), 0);
});

test('port handshake has a bounded wait and removes its listener on timeout', async () => {
    const backend = new EventEmitter();
    await assert.rejects(waitForBackendPort(backend, { timeoutMs: 20 }), /did not report its listening port/);
    assert.equal(backend.listenerCount('message'), 0);
});

test('reported ephemeral port is already owned by the child process', { timeout: 5000 }, async t => {
    const backend = spawn(process.execPath, ['--input-type=module', '-e', `
import { createServer } from 'node:http';
const server = createServer((req, res) => res.end('owned'));
server.listen(0, '127.0.0.1', () => process.send({ type: 'caddy-ui:listening', port: server.address().port }));
`], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const startup = new AbortController();
    backend.on('error', error => startup.abort(error));
    backend.once('exit', () => startup.abort(new Error('Test server exited')));
    t.after(async () => {
        if (backend.exitCode !== null || backend.signalCode !== null) return;
        const exited = once(backend, 'exit');
        backend.kill('SIGTERM');
        await exited;
    });
    const port = await waitForBackendPort(backend, { signal: startup.signal });
    const competing = createServer();
    t.after(() => new Promise(resolve => competing.close(() => resolve())));
    const result = new Promise(resolve => {
        competing.once('error', resolve);
        competing.once('listening', () => resolve(null));
    });
    competing.listen(port, '127.0.0.1');
    const error = await result;
    assert.equal(error?.code, 'EADDRINUSE');
    const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) });
    assert.equal(await response.text(), 'owned');
});

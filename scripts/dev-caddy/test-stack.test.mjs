import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { waitFor } from './test-stack.mjs';

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
    await waitFor(url, async response => response.ok && (await response.json()).version === 'fixture', 5000);
    assert.equal(requests, 3);
});

test('readiness exposes an already-known startup error directly', async () => {
    const failure = new Error('spawn failed');
    await assert.rejects(waitFor('http://127.0.0.1:1', undefined, 15000, { signal: AbortSignal.abort(failure) }), error => error === failure);
});

test('readiness aborts a pending fetch when the backend exits', { timeout: 5000 }, async t => {
    const startup = new AbortController();
    const failure = new Error('Backend exited (1) before readiness');
    const url = await endpoint(t, () => startup.abort(failure));
    await assert.rejects(waitFor(url, undefined, 15000, { signal: startup.signal }), error => error === failure);
});

test('startup failure is terminal even when the readiness predicate throws', { timeout: 5000 }, async t => {
    const startup = new AbortController();
    const failure = new Error('Backend exited (SIGTERM) before readiness');
    const url = await endpoint(t, (req, res) => res.end('ready'));
    await assert.rejects(waitFor(url, () => {
        startup.abort(failure);
        throw new Error('transient predicate error');
    }, 15000, { signal: startup.signal }), error => error === failure);
});

test('readiness still times out when a live service never becomes ready', async t => {
    const url = await endpoint(t, (req, res) => { res.writeHead(503); res.end(); });
    await assert.rejects(waitFor(url, undefined, 200), /Readiness timeout/);
});

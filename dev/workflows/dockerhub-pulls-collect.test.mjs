import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collect, emptyHistory, repositories, run, validateHistory } from '../../.github/scripts/dockerhub-pulls/collect.mjs';

const sample = (observedAt, count = 85000) => ({ observedAt, pullCount: count });
const history = (...samples) => ({ version: 1, repositories: Object.fromEntries(repositories.map(repository => [repository, [...samples]])) });
const response = count => new Response(JSON.stringify({ pull_count: count }), { headers: { 'Content-Type': 'application/json' } });
const day = value => new Date(`2026-10-${value}T00:17:00.000Z`);

test('collects integer repository totals with a request abort signal', async () => {
    const requests = [];
    const result = await collect(emptyHistory(), { now: day('25'), fetchImpl: async (url, options) => {
        requests.push(url);
        assert(options.signal instanceof AbortSignal);
        return response(85302);
    } });
    assert.deepEqual(requests, repositories.map(repository => `https://hub.docker.com/v2/repositories/${repository}/`));
    assert.equal(result.repositories[repositories[0]][0].pullCount, 85302);
});

test('the deadline can interrupt a stalled body after HTTP headers arrive', async t => {
    const server = createServer((req, res) => {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"pull_count":');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    const deadline = new AbortController();
    t.mock.method(AbortSignal, 'timeout', milliseconds => {
        assert.equal(milliseconds, 15000);
        return deadline.signal;
    });
    await assert.rejects(collect(emptyHistory(), { fetchImpl: async (url, options) => {
        const result = await fetch(`http://127.0.0.1:${server.address().port}`, options);
        setImmediate(() => deadline.abort(new DOMException('Controlled timeout', 'TimeoutError')));
        return result;
    } }), { name: 'TimeoutError' });
});

test('the first successful observation wins and a same-day rerun makes no API requests', async () => {
    const previous = history(sample(day('25').toISOString()));
    const updated = await collect(previous, { now: new Date('2026-10-25T23:00:00.000Z'), fetchImpl: async () => {
        assert.fail('already observed today; do not poll or replace it');
    } });
    assert.strictEqual(updated, previous);
    assert.equal(updated.repositories[repositories[0]][0].pullCount, 85000);
});

test('a rerun fills a missing repository without replacing an existing observation', async () => {
    const previous = { version: 1, repositories: { [repositories[0]]: [sample(day('25').toISOString())] } };
    const requested = [];
    const updated = await collect(previous, { now: new Date('2026-10-25T23:00:00.000Z'), fetchImpl: async url => {
        requested.push(url);
        return response(86000);
    } });
    assert.deepEqual(requested, [`https://hub.docker.com/v2/repositories/${repositories[1]}/`]);
    assert.deepEqual(updated.repositories[repositories[0]], previous.repositories[repositories[0]]);
    assert.equal(updated.repositories[repositories[1]][0].pullCount, 86000);
    assert.equal(previous.repositories[repositories[1]], undefined);
});

test('missing days are not invented, and counter corrections remain visible', async () => {
    const result = await collect(history(sample(day('20').toISOString())), { now: day('25'), fetchImpl: async () => response(84000) });
    assert.deepEqual(result.repositories[repositories[0]].map(value => value.observedAt.slice(0, 10)), ['2026-10-20', '2026-10-25']);
    assert.equal(result.repositories[repositories[0]].at(-1).pullCount, 84000);
});

test('invalid or failed API responses cannot become zero-count observations', async () => {
    for (const value of [-1, 1.5, '85302', null, Number.MAX_SAFE_INTEGER + 1]) {
        await assert.rejects(collect(emptyHistory(), { fetchImpl: async () => response(value) }), /invalid pull count/);
    }
    for (const body of ['null', '{}', '[]']) {
        await assert.rejects(collect(emptyHistory(), { fetchImpl: async () => new Response(body) }), /invalid pull count/);
    }
    const previous = history(sample(day('24').toISOString()));
    await assert.rejects(collect(previous, { now: day('25'), fetchImpl: async () => new Response('unavailable', { status: 503 }) }), /HTTP 503/);
    assert.equal(previous.repositories[repositories[0]].length, 1);
});

test('malformed existing history and observations going backwards fail without resetting history', async () => {
    const bad = [null, { version: 2, repositories: {} }, { version: 1, repositories: [] }, history(sample('invalid')), history(sample(day('25').toISOString()), sample(day('25').toISOString()))];
    for (const value of bad) assert.throws(() => validateHistory(value));
    await assert.rejects(collect(history(sample(day('25').toISOString())), { now: day('24'), fetchImpl: async () => response(86000) }), /predates/);
});

test('a failed collection leaves existing history untouched', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'dockerhub-pulls-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const previous = JSON.stringify(history(sample(day('24').toISOString())));
    await writeFile(join(directory, 'history.json'), previous);
    t.mock.method(globalThis, 'fetch', async url => url.includes('backend') ? response(86000) : new Response('rate limited', { status: 429 }));
    await assert.rejects(run(directory), /HTTP 429/);
    assert.equal(await readFile(join(directory, 'history.json'), 'utf8'), previous);
});

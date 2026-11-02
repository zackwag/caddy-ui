import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { caddyAdapt, caddyDelete, caddyGet, caddyGetConfig, caddyGetTagged, caddyLoad, caddyPatch, caddyPost, caddyReadJson, isClosedConnection } from '../src/caddy.js';

// A stand-in admin API over real HTTP. `closing` connections are dropped before
// any response, the way Caddy closes the old admin server's idle connections
// when a config load replaces it: closed, or reset when `reset` is set.
let requests;
let closing;
let reset;
let status;
const server = createServer((req, res) => {
    req.resume();
    requests.push(`${req.method} ${req.url}`);
    if (closing > 0) {
        closing--;
        if (reset) {
            req.socket.resetAndDestroy();
        } else {
            req.socket.destroy();
        }
        return;
    }
    res.writeHead(status, { 'Content-Type': 'application/json', ETag: '"/config/ abc"' });
    res.end(status === 200 ? '{"apps":{}}' : '{"error":"unavailable"}');
});
let adminUrl;

beforeAll(async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    adminUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
    requests = [];
    closing = 0;
    reset = false;
    status = 200;
});
afterAll(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
});

const reads = [
    ['caddyGet', () => caddyGet('/config/', adminUrl), { apps: {} }],
    ['caddyGetTagged', () => caddyGetTagged('/config/', adminUrl), { value: { apps: {} }, etag: '"/config/ abc"' }],
    ['caddyReadJson', () => caddyReadJson('/config/', adminUrl), { apps: {} }],
    ['caddyGetConfig', () => caddyGetConfig(adminUrl), { config: { apps: {} }, fingerprint: 'etag:"/config/ abc"' }],
    ['caddyAdapt', () => caddyAdapt('example.com {\n}\n', adminUrl), undefined],
];

describe('admin API connections Caddy closes during a reload', () => {
    it.each(reads)('sends %s once more after a closed connection', async (name, read, expected) => {
        closing = 1;
        expect(await read()).toEqual(expected);
        expect(requests).toHaveLength(2);
        expect(requests[0]).toBe(requests[1]);
    });

    it.each(reads)('sends %s once more after a reset connection', async (name, read, expected) => {
        closing = 1;
        reset = true;
        expect(await read()).toEqual(expected);
        expect(requests).toHaveLength(2);
    });

    it.each(reads)('retries %s only once', async (name, read) => {
        closing = 2;
        await expect(read()).rejects.toSatisfy(isClosedConnection);
        expect(requests).toHaveLength(2);
    });

    it.each(reads.filter(([name]) => name !== 'caddyAdapt'))('does not retry %s after an HTTP error', async (name, read) => {
        status = 503;
        await expect(read()).rejects.toMatchObject({ status: 503 });
        expect(requests).toHaveLength(1);
    });

    it.each([
        ['caddyPost', () => caddyPost('/config/apps/http/servers/srv0/routes', {}, adminUrl)],
        ['caddyPatch', () => caddyPatch('/id/route-a', {}, adminUrl)],
        ['caddyDelete', () => caddyDelete('/id/route-a', adminUrl)],
        ['caddyLoad', () => caddyLoad('example.com {\n}\n', adminUrl)],
    ])('never resends a write (%s), since Caddy may have applied it', async (name, write) => {
        for (const mode of [false, true]) {
            requests = [];
            closing = 1;
            reset = mode;
            await expect(write()).rejects.toThrow();
            expect(requests).toHaveLength(1);
        }
    });
});

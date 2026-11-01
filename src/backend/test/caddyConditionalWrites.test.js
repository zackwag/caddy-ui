import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { caddyDelete, caddyGet, caddyGetTagged, caddyPatch, caddyPost, caddyPut } from '../src/caddy.js';

// A stand-in admin API over real HTTP that serves one object with an ETag and,
// like Caddy, refuses a write whose If-Match no longer matches it.
const object = { '@id': 'route-a', match: [{ host: ['a.example.com'] }] };
const current = '"/config/apps/http/servers/srv0/routes/0 aaaa"';
let requests;
let etag;
const server = createServer((req, res) => {
    req.resume();
    requests.push({ method: req.method, url: req.url, ifMatch: req.headers['if-match'] });
    const ifMatch = req.headers['if-match'];
    if (req.method !== 'GET' && ifMatch && ifMatch !== current) {
        res.writeHead(412, { 'Content-Type': 'application/json' });
        res.end('{"error":"If-Match header did not match current config hash"}');
        return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', ...(etag ? { ETag: etag } : {}) });
    res.end(req.method === 'GET' ? JSON.stringify(object) : '');
});
let adminUrl;

beforeAll(async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    adminUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
    requests = [];
    etag = current;
});
afterAll(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
});

describe('conditional admin API writes', () => {
    it('returns the ETag with a tagged read, and only the value from a plain one', async () => {
        expect(await caddyGetTagged('/id/route-a', adminUrl)).toEqual({ value: object, etag: current });
        expect(await caddyGet('/id/route-a', adminUrl)).toEqual(object);
    });

    it('reports a missing ETag as null, as from Caddy releases without ETags', async () => {
        etag = null;
        expect(await caddyGetTagged('/id/route-a', adminUrl)).toEqual({ value: object, etag: null });
    });

    it.each([
        ['POST', () => caddyPost('/config/apps/http/servers/srv0/routes', object, adminUrl, { ifMatch: current })],
        ['PUT', () => caddyPut('/config/apps/http/servers/srv0/routes', [object], adminUrl, { ifMatch: current })],
        ['PATCH', () => caddyPatch('/id/route-a', object, adminUrl, { ifMatch: current })],
        ['DELETE', () => caddyDelete('/id/route-a', adminUrl, { ifMatch: current })],
    ])('sends If-Match on %s when given one', async (method, write) => {
        await write();
        expect(requests).toEqual([expect.objectContaining({ method, ifMatch: current })]);
    });

    it('rejects a stale precondition with the 412 status, without retrying', async () => {
        await expect(caddyPatch('/id/route-a', object, adminUrl, { ifMatch: '"/config/apps/http/servers/srv0/routes/0 stale"' }))
            .rejects.toMatchObject({ status: 412 });
        expect(requests).toHaveLength(1);
    });

    it.each([undefined, null])('writes unconditionally when the ETag is %s', async ifMatch => {
        await caddyDelete('/id/route-a', adminUrl, { ifMatch });
        await caddyPost('/config/apps/http/servers/srv0/routes', object, adminUrl);
        expect(requests.map(request => request.ifMatch)).toEqual([undefined, undefined]);
    });
});

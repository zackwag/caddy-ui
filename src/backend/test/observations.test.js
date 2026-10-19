import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { caddyLoad } from '../src/caddy.js';
import { clearObservations, getServers, OBSERVATION_MAX_AGE_MS } from '../src/observations.js';
import healthRouter from '../src/routes/health.js';
import statusRouter from '../src/routes/status.js';

async function listen(server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return server.address().port;
}

// A stand-in admin API serving one site that proxies to `upstream`, counting
// config reads. `failNextRead` simulates an outage; `hasRoute` an external removal.
async function fakeCaddy(upstream) {
    const caddy = { configReads: 0, failNextRead: false, hasRoute: true };
    caddy.server = createHttpServer((req, res) => {
        if (req.method === 'GET' && req.url === '/config/apps/http/servers') {
            caddy.configReads++;
            const fail = caddy.failNextRead;
            caddy.failNextRead = false;
            const snapshot = JSON.stringify({ srv0: { listen: [':443'], routes: caddy.hasRoute ? [{
                match: [{ host: ['app.example.com'] }],
                handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: upstream }] }],
            }] : [] } });
            const respond = () => {
                if (fail) res.writeHead(500).end('unavailable');
                else {
                    res.setHeader('Content-Type', 'application/json');
                    res.end(snapshot);
                }
            };
            const hold = caddy.nextConfigRead;
            caddy.nextConfigRead = null;
            if (hold) hold(respond);
            else respond();
            return;
        }
        req.resume();
        res.writeHead(req.url === '/load' ? 200 : 404).end();
    });
    caddy.adminUrl = `http://127.0.0.1:${await listen(caddy.server)}`;
    return caddy;
}

// Hold a response after its snapshot is captured, without timing-based sleeps.
function holdNextConfigRead(caddy) {
    let finish;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    caddy.nextConfigRead = respond => {
        finish = respond;
        markStarted();
    };
    return {
        started,
        release() {
            const respond = finish;
            finish = null;
            respond?.();
        },
    };
}

let dials = 0;
let upstreamServer;
let upstream;
let app;
let appServer;
let baseUrl;
const caddies = [];
let caddy;

beforeAll(async () => {
    upstreamServer = createTcpServer(socket => {
        dials++;
        socket.destroy();
    });
    upstream = `127.0.0.1:${await listen(upstreamServer)}`;
    caddy = await fakeCaddy(upstream);
    caddies.push(caddy, await fakeCaddy(upstream));

    app = express();
    app.use('/api', (req, res, next) => {
        const selected = caddies[Number(req.headers['x-caddy'] || 0)];
        req.instance = { id: 'test', adminUrl: selected.adminUrl, containerName: '' };
        next();
    });
    app.use('/api/status', statusRouter);
    app.use('/api/health', healthRouter);
    appServer = app.listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    baseUrl = `http://127.0.0.1:${appServer.address().port}/api`;
});

afterAll(async () => {
    for (const server of [appServer, upstreamServer, ...caddies.map(c => c.server)]) {
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(resolve));
    }
});

beforeEach(() => {
    clearObservations();
    dials = 0;
    for (const c of caddies) {
        c.configReads = 0;
        c.failNextRead = false;
        c.hasRoute = true;
        c.nextConfigRead = null;
    }
});

afterEach(() => vi.useRealTimers());

async function get(path, instance = 0) {
    const response = await fetch(baseUrl + path, { headers: { 'x-caddy': String(instance) } });
    expect(response.status).toBe(200);
    return response.json();
}

describe('shared configuration and upstream observations', () => {
    it('reads the config once and dials each upstream once for /api/status', async () => {
        expect(await get('/status')).toMatchObject({ online: true, upstreamsOnline: 1, upstreamsTotal: 1 });
        expect(caddy.configReads).toBe(1);
        expect(dials).toBe(1);
    });

    it('shares one read and one dial between concurrent /api/status and /api/health', async () => {
        const [status, health] = await Promise.all([get('/status'), get('/health')]);
        expect(status.upstreamsOnline).toBe(1);
        expect(health).toMatchObject([{ upstream, online: true }]);
        expect(caddy.configReads).toBe(1);
        expect(dials).toBe(1);
    });

    it('reuses a result until it is too old, reporting when it was observed', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const [first] = await get('/health');
        vi.advanceTimersByTime(OBSERVATION_MAX_AGE_MS);
        const [reused] = await get('/health');
        expect(reused.checkedAt).toBe(first.checkedAt);
        expect([caddy.configReads, dials]).toEqual([1, 1]);

        vi.advanceTimersByTime(1);
        const [fresh] = await get('/health');
        expect(Date.parse(fresh.checkedAt)).toBeGreaterThan(Date.parse(first.checkedAt));
        expect([caddy.configReads, dials]).toEqual([2, 2]);
    });

    it('reads again after a configuration write, however recent the last read', async () => {
        await get('/status');
        await caddyLoad('example.com {\n}\n', caddy.adminUrl);
        await get('/status');
        expect(caddy.configReads).toBe(2);
        expect(dials).toBe(2);
    });

    it.each([
        { outcome: 'succeeds', fail: false },
        { outcome: 'fails', fail: true },
    ])('keeps the newer config cached when an older pre-write read $outcome', async ({ fail }) => {
        const held = holdNextConfigRead(caddy);
        caddy.failNextRead = fail;
        const earlier = getServers(caddy.adminUrl);
        const earlierResult = earlier.then(value => ({ value }), error => ({ error }));
        try {
            await held.started;
            caddy.hasRoute = false;
            await caddyLoad('example.com {\n}\n', caddy.adminUrl);

            const later = getServers(caddy.adminUrl);
            expect(later).not.toBe(earlier);
            const fresh = await later;
            expect(fresh.srv0.routes).toEqual([]);
            expect(caddy.configReads).toBe(2);

            held.release();
            const result = await earlierResult;
            if (fail) expect(result.error.message).toContain('Caddy API error: 500');
            else expect(result.value.srv0.routes).toHaveLength(1);

            // Neither an old success nor an old rejection may displace the new entry.
            expect(await getServers(caddy.adminUrl)).toBe(fresh);
            expect(caddy.configReads).toBe(2);
        } finally {
            held.release();
            await earlierResult;
        }
    });

    it('refreshes upstream checks when their older source config expires', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        await getServers(caddy.adminUrl);
        vi.advanceTimersByTime(100);
        caddy.hasRoute = false;

        // The config is still cached when upstream checks are first requested.
        vi.advanceTimersByTime(OBSERVATION_MAX_AGE_MS - 200);
        expect(await get('/health')).toMatchObject([{ domain: 'app.example.com', upstream }]);
        expect([caddy.configReads, dials]).toEqual([1, 1]);

        // Config expiry must also retire checks built later from that old config.
        vi.advanceTimersByTime(201);
        const [status, health] = await Promise.all([get('/status'), get('/health')]);
        expect(status).toMatchObject({ online: true, routeCount: 0, upstreamsOnline: 0, upstreamsTotal: 0 });
        expect(health).toEqual([]);
        expect([caddy.configReads, dials]).toEqual([2, 1]);
    });

    it('does not reuse a failed read, so recovery shows on the next request', async () => {
        caddy.failNextRead = true;
        expect(await get('/status')).toMatchObject({ online: false });
        expect(await get('/status')).toMatchObject({ online: true, upstreamsOnline: 1 });
        expect(caddy.configReads).toBe(2);
    });

    it('keeps each instance separate', async () => {
        await Promise.all([get('/status', 0), get('/status', 1)]);
        expect(caddies.map(c => c.configReads)).toEqual([1, 1]);
        expect(dials).toBe(2);
    });
});

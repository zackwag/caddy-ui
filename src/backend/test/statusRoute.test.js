import { once } from 'node:events';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import statusRouter from '../src/routes/status.js';

const { getServers, getUpstreamChecks } = vi.hoisted(() => ({
    getServers: vi.fn(),
    getUpstreamChecks: vi.fn(),
}));

vi.mock('../src/observations.js', () => ({ getServers, getUpstreamChecks }));

const request = globalThis.fetch;
const adminUrl = 'http://caddy:2019';
let server;
let statusUrl;

beforeAll(async () => {
    const app = express();
    app.use('/api/status', (req, res, next) => {
        req.instance = { adminUrl };
        next();
    }, statusRouter);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    statusUrl = `http://127.0.0.1:${server.address().port}/api/status`;
});

afterAll(() => new Promise(resolve => server.close(resolve)));
afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
    getServers.mockReset().mockResolvedValue({ srv0: { listen: [':80'], routes: [{}] } });
    getUpstreamChecks.mockReset().mockResolvedValue({ checks: [], checkedAt: new Date() });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
});

async function status() {
    const response = await request(statusUrl);
    expect(response.status).toBe(200);
    return response.json();
}

describe('GET /api/status', () => {
    it('reports offline when the stopped Caddy instance rejects all checks', async () => {
        getServers.mockRejectedValue(new Error('Caddy connection refused'));
        fetch.mockRejectedValue(new Error('Metrics connection refused'));
        getUpstreamChecks.mockRejectedValue(new Error('Upstream checks unavailable'));

        expect(await status()).toMatchObject({ online: false, error: expect.any(String) });
    });

    it('reports offline when the configuration request fails despite successful optional checks', async () => {
        getServers.mockRejectedValue(new Error('Caddy API timeout'));
        fetch.mockResolvedValue({ ok: true, text: async () => 'process_start_time_seconds 1700000000' });

        expect(await status()).toMatchObject({ online: false, error: expect.any(String) });
    });

    it('reports online again when a later configuration request succeeds', async () => {
        getServers.mockRejectedValueOnce(new Error('Caddy connection refused'));

        expect((await status()).online).toBe(false);
        expect(await status()).toMatchObject({ online: true, serverCount: 1, routeCount: 1 });
    });

    it.each(['connection failure', 'unavailable endpoint'])('stays online with metrics %s', async failure => {
        if (failure === 'connection failure') fetch.mockRejectedValue(new Error('Metrics connection refused'));

        expect(await status()).toMatchObject({ online: true, serverCount: 1, routeCount: 1, uptime: null });
    });

    it('stays online when upstream checks fail', async () => {
        getUpstreamChecks.mockRejectedValue(new Error('Upstream checks unavailable'));

        expect(await status()).toMatchObject({ online: true, upstreamsOnline: null, upstreamsTotal: null });
    });

    it('stays online when the fetched configuration has no HTTP servers', async () => {
        getServers.mockResolvedValue(null);

        expect(await status()).toMatchObject({ online: true, serverCount: 0, routeCount: 0, servers: [] });
    });
});

import { once } from 'node:events';
import { chmod, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import routesRouter from '../src/routes/routes.js';
import tlsRouter from '../src/routes/tls.js';

const { caddyGet } = vi.hoisted(() => ({ caddyGet: vi.fn() }));

vi.mock('../src/caddy.js', async importOriginal => ({ ...await importOriginal(), caddyGet }));

const fixtureCert = new URL('./fixtures/app.example.com.crt', import.meta.url);
const servers = {
    srv0: { listen: [':443'], routes: [{ match: [{ host: ['app.example.com'] }], handle: [] }] },
};

let dir;
let server;
let baseUrl;
const instance = {};

beforeAll(async () => {
    const app = express();
    app.use('/api', (req, res, next) => {
        req.instance = { id: 'test', adminUrl: 'http://caddy:2019', containerName: '', ...instance };
        next();
    });
    app.use('/api/routes', routesRouter);
    app.use('/api/tls', tlsRouter);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

afterAll(() => new Promise(resolve => server.close(resolve)));

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'caddy-ui-availability-'));
    instance.dataPath = join(dir, 'caddy');
    caddyGet.mockReset();
});

afterEach(async () => {
    await chmod(join(dir, 'caddy', 'certificates'), 0o755).catch(() => { });
    await rm(dir, { recursive: true, force: true });
});

const get = async path => {
    const res = await fetch(baseUrl + path);
    return { status: res.status, body: await res.json() };
};

async function storeCert() {
    const certDir = join(instance.dataPath, 'certificates', 'acme-v02.api.letsencrypt.org-directory', 'app.example.com');
    await mkdir(certDir, { recursive: true });
    await copyFile(fixtureCert, join(certDir, 'app.example.com.crt'));
}

describe('GET /api/routes', () => {
    it('returns an empty list when Caddy has no HTTP servers', async () => {
        caddyGet.mockResolvedValue(null);
        expect(await get('/routes')).toEqual({ status: 200, body: [] });
    });

    it('lists routes from the live config', async () => {
        caddyGet.mockResolvedValue(servers);
        const { status, body } = await get('/routes');
        expect(status).toBe(200);
        expect(body).toMatchObject([{ _server: 'srv0', match: [{ host: ['app.example.com'] }] }]);
    });

    it('reports an unreachable Caddy instead of an empty list', async () => {
        caddyGet.mockRejectedValue(new Error('connect ECONNREFUSED'));
        const { status, body } = await get('/routes');
        expect(status).toBe(503);
        expect(body).toMatchObject({ code: 'CADDY_CONFIG_UNAVAILABLE' });
        expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    });
});

describe('GET /api/tls', () => {
    it('returns an empty list before Caddy has stored any certificate', async () => {
        caddyGet.mockResolvedValue(servers);
        await mkdir(instance.dataPath, { recursive: true });
        expect(await get('/tls')).toEqual({ status: 200, body: [] });
    });

    it('returns an empty list when Caddy has no data directory yet (HTTP-only setups)', async () => {
        caddyGet.mockResolvedValue(servers);
        expect(await get('/tls')).toEqual({ status: 200, body: [] });
    });

    it.skipIf(process.getuid?.() === 0)('reports unreadable certificate storage instead of an empty list', async () => {
        caddyGet.mockResolvedValue(servers);
        await storeCert();
        await chmod(join(instance.dataPath, 'certificates'), 0o000);
        const { status, body } = await get('/tls');
        expect(status).toBe(500);
        expect(body).toMatchObject({ code: 'CERTIFICATE_READ_FAILED' });
    });

    it('marks certificates managed when Caddy lists their domain', async () => {
        caddyGet.mockImplementation(async path => (path === '/config/apps/http/servers' ? servers : null));
        await storeCert();
        const { status, body } = await get('/tls');
        expect(status).toBe(200);
        expect(body).toMatchObject([{ domain: 'app.example.com', isManaged: true, status: 'valid' }]);
    });

    it("still lists certificates when Caddy's config is unavailable, with management unknown", async () => {
        caddyGet.mockRejectedValue(new Error('connect ECONNREFUSED'));
        await storeCert();
        const { status, body } = await get('/tls');
        expect(status).toBe(200);
        expect(body).toMatchObject([{ domain: 'app.example.com', isManaged: null, status: 'valid' }]);
    });

    it.skipIf(process.getuid?.() === 0)('refuses deletion with a read error when storage is unreadable', async () => {
        caddyGet.mockResolvedValue(servers);
        await storeCert();
        await chmod(join(instance.dataPath, 'certificates'), 0o000);
        const res = await fetch(`${baseUrl}/tls/app.example.com`, { method: 'DELETE' });
        expect(res.status).toBe(500);
        expect(await res.json()).toMatchObject({ code: 'CERTIFICATE_READ_FAILED' });
    });
});

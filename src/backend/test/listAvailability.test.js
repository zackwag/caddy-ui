import { chmod, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { serve } from './fixtures/server.mjs';
import routesRouter from '../src/routes/routes.js';
import tlsRouter from '../src/routes/tls.js';
import { markConfigChanged } from '../src/caddy.js';

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
    server = await serve(app => {
        app.use('/api', (req, res, next) => {
            req.instance = { id: 'test', adminUrl: 'http://caddy:2019', containerName: '', ...instance };
            next();
        });
        app.use('/api/routes', routesRouter);
        app.use('/api/tls', tlsRouter);
    });
    baseUrl = server.url + '/api';
});

afterAll(() => server.close());

beforeEach(async () => {
    markConfigChanged('http://caddy:2019');
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

async function storeCert(issuer = 'acme-v02.api.letsencrypt.org-directory') {
    const certDir = join(instance.dataPath, 'certificates', issuer, 'app.example.com');
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

    describe('deletion', () => {
        const local = 'local';
        const acme = 'acme-v02.api.letsencrypt.org-directory';
        const remove = async query => {
            const res = await fetch(`${baseUrl}/tls/app.example.com${query}`, { method: 'DELETE' });
            return { status: res.status, body: await res.json() };
        };
        const stored = async () => (await get('/tls')).body.map(cert => cert.issuerDir);

        it('is refused for a certificate Caddy still uses', async () => {
            caddyGet.mockImplementation(async path => (path === '/config/apps/http/servers' ? servers : null));
            await storeCert(acme);
            expect((await get('/tls')).body).toMatchObject([{ deletable: false }]);
            expect(await remove('')).toMatchObject({ status: 403, body: { code: 'CERTIFICATE_DELETE_DENIED' } });
            expect(await stored()).toEqual([acme]);
        });

        it('removes only the named issuer when both certificates are unused', async () => {
            caddyGet.mockResolvedValue(null);
            await storeCert(acme);
            await storeCert(local);
            expect((await get('/tls')).body.every(cert => cert.deletable)).toBe(true);
            expect((await remove(`?issuer=${acme}`)).status).toBe(200);
            expect(await stored()).toEqual([local]);
        });

        it('prefers the local certificate when no issuer is named', async () => {
            caddyGet.mockResolvedValue(null);
            await storeCert(acme);
            await storeCert(local);
            expect((await remove('')).status).toBe(200);
            expect(await stored()).toEqual([acme]);
        });
    });
});

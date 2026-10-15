import { once } from 'node:events';
import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import tlsRouter from '../src/routes/tls.js';

const { caddyGet, readContainerDir, listContainerDir, readContainerFile, loadedCertificates } = vi.hoisted(() => ({
    caddyGet: vi.fn(), readContainerDir: vi.fn(), listContainerDir: vi.fn(), readContainerFile: vi.fn(), loadedCertificates: vi.fn(),
}));
vi.mock('../src/caddy.js', () => ({ caddyGet }));
vi.mock('../src/containerFs.js', () => ({ readContainerDir, listContainerDir, readContainerFile, describeReadError: err => err.message, removeContainerPath: vi.fn() }));
vi.mock('../src/loadedCertificates.js', async importOriginal => ({ ...await importOriginal(), loadedCertificates }));

let server;
let url;
const domain = 'site.example.com';
const pem = rootCertificates[0];
const cert = new X509Certificate(pem);

beforeAll(async () => {
    const app = express();
    app.use('/tls', (req, res, next) => {
        req.instance = { adminUrl: 'http://caddy:2019', dataPath: '/data/caddy', containerName: 'caddy' };
        next();
    }, tlsRouter);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    url = `http://127.0.0.1:${server.address().port}/tls`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));
afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});
beforeEach(() => {
    vi.stubEnv('CADDY_UI_HYBRID', 'false');
    caddyGet.mockReset().mockImplementation(async path => path.endsWith('/tls') ? null : { srv0: { listen: [':443'], routes: [{ match: [{ host: [domain] }] }] } });
    readContainerDir.mockReset().mockResolvedValue(['acme-v02.api.letsencrypt.org-directory']);
    listContainerDir.mockReset().mockResolvedValue([domain]);
    readContainerFile.mockReset().mockResolvedValue(pem);
    loadedCertificates.mockReset().mockResolvedValue([]);
});

describe('TLS inventory API', () => {
    it('distinguishes expired stored files from configured files without asserting live certificate state', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(Date.parse(cert.validTo) + 86400000));
        loadedCertificates.mockResolvedValue([{ domain: '*.example.com', issuer: 'imported', issuerName: 'Cloudflare Origin CA', source: 'configured-file', status: 'valid', deletable: false }]);
        const response = await fetch(url);
        expect(response.status).toBe(200);
        const [configured, stored] = await response.json();
        expect(configured).toMatchObject({ source: 'configured-file', status: 'valid', deletable: false });
        expect(stored).toMatchObject({ domain, source: 'stored', status: 'expired', deletable: false });
        expect(stored.issuerName).not.toBe("Let's Encrypt");
        expect(stored).not.toHaveProperty('active');
    });

    it('only offers eligible orphaned storage deletion outside hybrid mode', async () => {
        caddyGet.mockResolvedValue(null);
        expect((await (await fetch(url)).json())[0]).toMatchObject({ status: 'orphaned', deletable: true });
        vi.stubEnv('CADDY_UI_HYBRID', 'true');
        expect((await (await fetch(url)).json())[0]).toMatchObject({ status: 'orphaned', deletable: false });
    });

    it('returns a structured read error when configured certificate discovery fails', async () => {
        loadedCertificates.mockRejectedValue(new Error('admin is unreachable'));
        const response = await fetch(url);
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ code: 'CERTIFICATE_READ_FAILED' });
    });
});

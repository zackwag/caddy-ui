import { once } from 'node:events';
import { mkdtempSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { files, failWrites, caddyLoad, caddyGet, caddyPost } = vi.hoisted(() => ({
    files: new Map(),
    // Writes to fail, counted from 1 since the last reset
    failWrites: { at: [], count: 0 },
    caddyLoad: vi.fn(),
    caddyGet: vi.fn(),
    caddyPost: vi.fn(),
}));

vi.mock('../src/containerFs.js', async importOriginal => ({
    ...await importOriginal(),
    readContainerFile: vi.fn(async (container, path) => {
        if (!files.has(path)) throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
        return files.get(path);
    }),
    writeContainerFile: vi.fn(async (container, path, content) => {
        failWrites.count++;
        if (failWrites.at.includes(failWrites.count)) throw new Error('EACCES: permission denied');
        files.set(path, content);
    }),
    removeContainerPath: vi.fn(async (container, path) => { files.delete(path); }),
}));
vi.mock('../src/caddy.js', async importOriginal => ({ ...await importOriginal(), caddyLoad, caddyGet, caddyPost }));
vi.mock('../src/docker.js', async importOriginal => ({ ...await importOriginal(), getCaddyEnv: vi.fn(async () => ({})) }));

// HISTORY_PATH is read at import time, so set it before importing the module
process.env.HISTORY_PATH = mkdtempSync(join(tmpdir(), 'caddy-ui-history-'));
const { saveCaddyfileChange, default: caddyfileRouter } = await import('../src/routes/caddyfile.js');
const { default: metricsRouter } = await import('../src/routes/metrics.js');
const { default: routesRouter } = await import('../src/routes/routes.js');

// Local mode (no container), so a failed /load has no binary fallback
const instance = { id: 'default', adminUrl: 'http://caddy:2019', configPath: '/etc/caddy/Caddyfile', containerName: '', serverName: 'srv0' };
const original = '{\n    admin :2019\n}\n\nold.example.com {\n}\n';
const historyFiles = () => readdirSync(process.env.HISTORY_PATH).filter(f => f.startsWith('Caddyfile-'));

beforeEach(() => {
    files.clear();
    files.set(instance.configPath, original);
    failWrites.at = [];
    failWrites.count = 0;
    caddyLoad.mockReset().mockResolvedValue(null);
    caddyGet.mockReset();
    caddyPost.mockReset().mockResolvedValue(null);
});

describe('saveCaddyfileChange', () => {
    it('writes, reloads, and snapshots the previous file', async () => {
        const before = historyFiles().length;
        await expect(saveCaddyfileChange(instance, 'new.example.com {\n}\n')).resolves.toEqual({ applied: true });
        expect(files.get(instance.configPath)).toBe('new.example.com {\n}\n');
        expect(caddyLoad).toHaveBeenCalledWith('new.example.com {\n}\n', instance.adminUrl);
        expect(historyFiles().length).toBeGreaterThan(before);
    });

    it('restores the previous file when Caddy rejects the change', async () => {
        caddyLoad.mockRejectedValue(new Error('Caddy API error: 400 adapting config'));
        await expect(saveCaddyfileChange(instance, 'broken {\n')).rejects.toMatchObject({ code: 'CADDYFILE_CHANGE_REJECTED' });
        expect(files.get(instance.configPath)).toBe(original);
    });

    it('applies a custom live change after writing, and restores the file when it fails', async () => {
        const apply = vi.fn(async () => {
            expect(files.get(instance.configPath)).toBe('api.example.com {\n}\n');
            throw new Error('Caddy API error: 404 unknown object ID');
        });
        await expect(saveCaddyfileChange(instance, 'api.example.com {\n}\n', { apply })).rejects.toMatchObject({ code: 'CADDYFILE_CHANGE_REJECTED' });
        expect(apply).toHaveBeenCalledTimes(1);
        expect(caddyLoad).not.toHaveBeenCalled();
        expect(files.get(instance.configPath)).toBe(original);
    });

    it('reports when the previous file could not be restored', async () => {
        caddyLoad.mockRejectedValue(new Error('Caddy API error: 400 adapting config'));
        failWrites.at = [2];
        await expect(saveCaddyfileChange(instance, 'broken {\n')).rejects.toMatchObject({
            code: 'CADDYFILE_ROLLBACK_FAILED', context: { stage: 'apply' },
        });
        expect(files.get(instance.configPath)).toBe('broken {\n');
    });

    it('reports a failed write without reloading Caddy', async () => {
        failWrites.at = [1];
        await expect(saveCaddyfileChange(instance, 'new.example.com {\n}\n')).rejects.toMatchObject({ code: 'CADDYFILE_WRITE_FAILED' });
        expect(caddyLoad).not.toHaveBeenCalled();
        expect(files.get(instance.configPath)).toBe(original);
    });

    it('removes a new file again when there was no previous Caddyfile', async () => {
        files.clear();
        caddyLoad.mockRejectedValue(new Error('Caddy API error: 400 adapting config'));
        await expect(saveCaddyfileChange(instance, 'broken {\n')).rejects.toMatchObject({ code: 'CADDYFILE_CHANGE_REJECTED' });
        expect(files.has(instance.configPath)).toBe(false);
    });

    it('keeps the new file without rolling back when asked (force save)', async () => {
        caddyLoad.mockRejectedValue(new Error('Caddy API error: 400 adapting config'));
        const result = await saveCaddyfileChange(instance, 'forced {\n}\n', { rollback: false });
        expect(result).toMatchObject({ applied: false });
        expect(files.get(instance.configPath)).toBe('forced {\n}\n');
    });
});

describe('API save paths', () => {
    let server;
    let baseUrl;

    beforeAll(async () => {
        const app = express();
        app.use(express.json());
        app.use(express.text({ type: 'text/plain' }));
        app.use('/api', (req, res, next) => { req.instance = instance; next(); });
        app.use('/api/caddyfile', caddyfileRouter);
        app.use('/api/metrics', metricsRouter);
        app.use('/api/routes', routesRouter);
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    });

    afterAll(() => new Promise(resolve => server.close(resolve)));

    const send = async (method, path, body) => {
        const text = typeof body === 'string';
        const res = await fetch(baseUrl + path, {
            method,
            headers: { 'Content-Type': text ? 'text/plain' : 'application/json' },
            body: text ? body : JSON.stringify(body),
        });
        return { status: res.status, body: await res.json() };
    };

    it('restores the Caddyfile when Caddy rejects a metrics change', async () => {
        caddyLoad.mockRejectedValue(new Error('Caddy API error: 400 loading config'));
        const { status, body } = await send('PUT', '/metrics/config', { enabled: true });
        expect(status).toBe(422);
        expect(body).toMatchObject({ code: 'CADDYFILE_CHANGE_REJECTED' });
        expect(files.get(instance.configPath)).toBe(original);
    });

    it('saves a metrics change Caddy accepts', async () => {
        expect((await send('PUT', '/metrics/config', { enabled: true })).status).toBe(200);
        expect(files.get(instance.configPath)).toMatch(/^\{\n {4}metrics/);
    });

    it("reports a force-saved file Caddy rejected as written but not applied", async () => {
        caddyLoad.mockRejectedValue(new Error('Caddy API error: 400 loading config'));
        const { status, body } = await send('PUT', '/caddyfile?fmt=false&sort=false&validate=false', 'forced {\n}\n');
        expect(status).toBe(200);
        expect(body).toMatchObject({ ok: true, warning: expect.stringContaining('400') });
        expect(files.get(instance.configPath)).toBe('forced {\n}\n');
    });

    it('reports an editor save whose rollback failed, with the file left changed', async () => {
        const request = globalThis.fetch;
        // Validation passes through Caddy's /adapt; the reload is what fails
        vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => (String(url).startsWith(instance.adminUrl)
            ? Promise.resolve(new Response('{}', { status: 200 }))
            : request(url, opts)));
        caddyLoad.mockRejectedValue(new Error('Caddy API error: 400 loading config'));
        failWrites.at = [2];
        const { status, body } = await send('PUT', '/caddyfile?fmt=false&sort=false', 'x {\n}\n');
        vi.restoreAllMocks();
        expect(status).toBe(500);
        expect(body).toMatchObject({ valid: false, code: 'CADDYFILE_ROLLBACK_FAILED' });
        expect(body.errors[0]).toMatch(/Caddy reload failed: .*400/);
        expect(files.get(instance.configPath)).toBe('x {\n}\n');
    });

    it('restores the Caddyfile when Caddy rejects a new route', async () => {
        caddyGet.mockResolvedValue({ srv0: { listen: [':443'], routes: [] } });
        caddyPost.mockRejectedValue(new Error('Caddy API error: 400 invalid route'));
        const { status, body } = await send('POST', '/routes', { domain: 'app.example.com', upstream: 'app:3000' });
        expect(status).toBe(422);
        expect(body).toMatchObject({ code: 'CADDYFILE_CHANGE_REJECTED' });
        expect(files.get(instance.configPath)).toBe(original);
    });

    it("doesn't add a live route when the Caddyfile can't be written", async () => {
        caddyGet.mockResolvedValue({ srv0: { listen: [':443'], routes: [] } });
        failWrites.at = [1];
        const { status, body } = await send('POST', '/routes', { domain: 'app.example.com', upstream: 'app:3000' });
        expect(status).toBe(500);
        expect(body).toMatchObject({ code: 'CADDYFILE_WRITE_FAILED' });
        expect(caddyPost).not.toHaveBeenCalled();
        expect(files.get(instance.configPath)).toBe(original);
    });

    it('adds the route to the Caddyfile and to Caddy', async () => {
        caddyGet.mockResolvedValue({ srv0: { listen: [':443'], routes: [] } });
        expect((await send('POST', '/routes', { domain: 'app.example.com', upstream: 'app:3000' })).status).toBe(201);
        expect(caddyPost).toHaveBeenCalledTimes(1);
        expect(files.get(instance.configPath)).toContain('app.example.com {');
    });
});

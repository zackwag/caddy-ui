import { once } from 'node:events';
import { mkdtempSync, readdirSync } from 'fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createCaddyfileHistory } from '../src/caddyfileHistory.js';
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
vi.mock('../src/middleware/auth.js', () => ({ getAuthentication: () => ({ getActor: req => req.actor, resolveActor: () => null }) }));

// HISTORY_PATH is read at import time, so set it before importing the module
process.env.HISTORY_PATH = mkdtempSync(join(tmpdir(), 'caddy-ui-history-'));
process.env.MAINTENANCE_PATH = process.env.HISTORY_PATH + '-maintenance.json';
process.env.WWW_PATH = process.env.HISTORY_PATH + '-www';
process.env.CADDY_UI_URL = 'caddy-ui-backend:3001';
const { saveCaddyfileChange, default: caddyfileRouter } = await import('../src/routes/caddyfile.js');
const { default: metricsRouter } = await import('../src/routes/metrics.js');
const { default: logsRouter } = await import('../src/routes/logs.js');
const { default: routesRouter } = await import('../src/routes/routes.js');
const { getMaintenanceState } = await import('../src/maintenance.js');
afterAll(async () => {
    await rm(process.env.HISTORY_PATH, { recursive: true, force: true });
    await rm(process.env.MAINTENANCE_PATH, { force: true });
    await rm(process.env.WWW_PATH, { recursive: true, force: true });
});

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
    it('runs asynchronous transforms against the preceding committed content inside the queue', async () => {
        let release, started;
        const gate = new Promise(resolve => { release = resolve; });
        const ready = new Promise(resolve => { started = resolve; });
        const firstActor = { type: 'user', id: randomUUID(), name: 'First actor' };
        const secondActor = { type: 'api-token', id: 'c'.repeat(32), name: 'Second actor' };
        const first = saveCaddyfileChange(instance, previous => previous + '\nfirst.example.com {}', {
            actor: firstActor, apply: async () => { started(); await gate; },
        });
        await ready;
        const second = saveCaddyfileChange(instance, async previous => previous + '\nsecond.example.com {}', { actor: secondActor });
        release();
        await Promise.all([first, second]);
        expect(files.get(instance.configPath)).toContain('first.example.com {}\nsecond.example.com {}');
        const history = createCaddyfileHistory(process.env.HISTORY_PATH);
        const entries = await history.list('default');
        expect(entries[0].actor).toEqual(secondActor);
        expect(entries[1].actor).toEqual(firstActor);
        expect(entries[0].parent).toBe(entries[1].filename);
        expect((await history.read('default', entries[0].filename)).content).toContain('first.example.com {}\nsecond.example.com {}');
    });
    it('commits saved content to its actor and serializes concurrent saves', async () => {
        let release, started;
        const gate = new Promise(resolve => { release = resolve; });
        const ready = new Promise(resolve => { started = resolve; });
        const actor = { type: 'user', id: randomUUID(), name: 'administrator' };
        const nextActor = { type: 'api-token', id: 'b'.repeat(32), name: 'Automation' };
        const first = saveCaddyfileChange(instance, 'first committed content', { actor, apply: async () => { started(); await gate; } });
        await ready;
        const second = saveCaddyfileChange(instance, 'second committed content', { actor: nextActor });
        expect(files.get(instance.configPath)).toBe('first committed content');
        release();
        await Promise.all([first, second]);
        const history = createCaddyfileHistory(process.env.HISTORY_PATH);
        const entries = await history.list('default');
        expect(entries[0].actor).toEqual(nextActor);
        expect(entries[1].actor).toEqual(actor);
        expect(entries[0].parent).toBe(entries[1].filename);
        expect((await history.read('default', entries[0].filename)).content).toBe('second committed content');
        expect((await history.read('default', entries[1].filename)).content).toBe('first committed content');
    });

    it.each([false, true])('reports history storage failure accurately (after apply: %s)', async afterApply => {
        const root = process.env.HISTORY_PATH;
        const backup = root + '-backup';
        const block = async () => { await rename(root, backup); await writeFile(root, 'blocked'); };
        if (!afterApply) await block();
        try {
            const operation = saveCaddyfileChange(instance, 'saved despite history failure', { apply: afterApply ? block : caddyLoad });
            if (afterApply) await expect(operation).resolves.toMatchObject({ applied: true, warningCode: 'CADDYFILE_HISTORY_COMMIT_FAILED' });
            else await expect(operation).rejects.toMatchObject({ code: 'CADDYFILE_HISTORY_WRITE_FAILED' });
            expect(files.get(instance.configPath)).toBe(afterApply ? 'saved despite history failure' : original);
            if (!afterApply) expect(caddyLoad).not.toHaveBeenCalled();
            expect((await readFile(root, 'utf8'))).toBe('blocked');
        } finally {
            await rm(root);
            await rename(backup, root);
        }
    });

    it('writes, reloads, and snapshots the previous file', async () => {
        const before = historyFiles().length;
        await expect(saveCaddyfileChange(instance, 'new.example.com {\n}\n')).resolves.toEqual({ applied: true });
        expect(files.get(instance.configPath)).toBe('new.example.com {\n}\n');
        expect(caddyLoad).toHaveBeenCalledWith('new.example.com {\n}\n', instance.adminUrl);
        expect(historyFiles().length).toBeGreaterThan(before);
    });

    it('restores the previous file when Caddy rejects the change', async () => {
        caddyLoad.mockRejectedValue(new Error('Caddy API error: 400 adapting config'));
        const actor = { type: 'user', id: randomUUID(), name: 'Failed edit' };
        await expect(saveCaddyfileChange(instance, 'broken {\n', { actor })).rejects.toMatchObject({ code: 'CADDYFILE_CHANGE_REJECTED' });
        expect(files.get(instance.configPath)).toBe(original);
        const entries = await createCaddyfileHistory(process.env.HISTORY_PATH).list('default');
        expect(entries.some(entry => entry.actor?.id === actor.id)).toBe(false);
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
        const history = createCaddyfileHistory(process.env.HISTORY_PATH);
        const latest = (await history.list('default'))[0];
        expect(latest.outcome).toBe('saved-unapplied');
        expect((await history.read('default', latest.filename)).content).toBe('forced {\n}\n');
    });
});

describe('API save paths', () => {
    let server;
    let baseUrl;
    const actor = { type: 'user', id: randomUUID(), name: 'Authenticated administrator' };

    beforeAll(async () => {
        const app = express();
        app.use(express.json());
        app.use(express.text({ type: 'text/plain' }));
        app.use('/api', (req, res, next) => { req.instance = instance; req.actor = actor; next(); });
        app.use('/api/caddyfile', caddyfileRouter);
        app.use('/api/metrics', metricsRouter);
        app.use('/api/logs', logsRouter);
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

    it.each([
        ['PUT', '/caddyfile?fmt=false&sort=false&validate=false', 'new.example.com {}'],
        ['PUT', '/metrics/config', { enabled: true }],
        ['PUT', '/logs/config', { enabled: true, path: '/tmp/review-access.log', format: 'json', level: 'INFO', rollSize: '50mb', rollKeep: 5 }],
        ['POST', '/routes', { domain: 'new.example.com', upstream: 'app:3000' }],
    ])('returns success with a warning after a live %s %s whose history commit fails', async (method, path, body) => {
        const root = process.env.HISTORY_PATH, backup = root + '-backup';
        const block = async () => { await rename(root, backup); await writeFile(root, 'blocked'); };
        const request = globalThis.fetch;
        vi.spyOn(globalThis, 'fetch').mockImplementation((url, options) => String(url).startsWith(instance.adminUrl)
            ? Promise.resolve(new Response('{}', { status: 200 })) : request(url, options));
        caddyLoad.mockImplementationOnce(block);
        caddyPost.mockImplementationOnce(block);
        caddyGet.mockResolvedValue({ srv0: { listen: [':443'], routes: [] } });
        try {
            const result = await send(method, path, body);
            expect(result.status).toBe(method === 'POST' ? 201 : 200);
            expect(result.body).toMatchObject({ ok: true, warningCode: 'CADDYFILE_HISTORY_COMMIT_FAILED' });
            expect(files.get(instance.configPath)).not.toBe(original);
        } finally {
            vi.restoreAllMocks();
            await rm(root, { recursive: true, force: true });
            await rename(backup, root);
        }
    });

    it('preserves the original maintenance block and can disable maintenance after a history commit failure', async () => {
        const root = process.env.HISTORY_PATH, backup = root + '-backup';
        caddyLoad.mockImplementationOnce(async () => { await rename(root, backup); await writeFile(root, 'blocked'); });
        try {
            const result = await send('POST', '/routes/caddyfile/old.example.com/maintenance');
            expect(result.status).toBe(200);
            expect(result.body.warningCode).toBe('CADDYFILE_HISTORY_COMMIT_FAILED');
            expect(getMaintenanceState('default')['old.example.com'].originalContent).toContain('old.example.com {');
        } finally { await rm(root, { force: true }); await rename(backup, root); }
        expect((await send('DELETE', '/routes/caddyfile/old.example.com/maintenance')).status).toBe(200);
        expect(files.get(instance.configPath)).not.toContain('/public/responses/maintenance');
        expect(getMaintenanceState('default')['old.example.com']).toBeUndefined();
    });

    it('keeps concurrent route additions and metrics updates in both the file and attributed history', async () => {
        caddyGet.mockResolvedValue({ srv0: { listen: [':443'], routes: [] } });
        const results = await Promise.all([
            send('POST', '/routes', { domain: 'first.example.com', upstream: 'one:3000' }),
            send('POST', '/routes', { domain: 'second.example.com', upstream: 'two:3000' }),
            send('PUT', '/metrics/config', { enabled: true }),
        ]);
        expect(results.map(result => result.status)).toEqual([201, 201, 200]);
        expect(results[0].body.id).not.toBe(results[1].body.id);
        const final = files.get(instance.configPath);
        expect(final).toContain('first.example.com');
        expect(final).toContain('second.example.com');
        expect(final).toMatch(/^\{\n {4}metrics/);
        const history = createCaddyfileHistory(process.env.HISTORY_PATH);
        const latest = (await history.list('default'))[0];
        expect((await history.read('default', latest.filename)).content).toBe(final);
    });

    it.each(['restore', 'import'])('records a distinct %s action and restores text without formatting or sorting', async action => {
        const request = globalThis.fetch;
        vi.spyOn(globalThis, 'fetch').mockImplementation((url, options) => String(url).startsWith(instance.adminUrl)
            ? Promise.resolve(new Response('{}', { status: 200 })) : request(url, options));
        const content = '# preserved heading\nz.example.com {\n\trespond "unchanged"\n}\n';
        try {
            const result = await send('PUT', '/caddyfile?action=' + action + '&fmt=false&sort=false', content);
            expect(result.status).toBe(200);
            expect(files.get(instance.configPath)).toBe(content);
            const history = createCaddyfileHistory(process.env.HISTORY_PATH);
            expect((await history.list('default'))[0].action).toBe('caddyfile.' + action);
        } finally { vi.restoreAllMocks(); }
    });

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
        expect((await send('POST', '/routes', { domain: 'app.example.com', upstream: 'app:3000',
            actor: { type: 'user', id: randomUUID(), name: 'Forged actor' } })).status).toBe(201);
        expect(caddyPost).toHaveBeenCalledTimes(1);
        expect(files.get(instance.configPath)).toContain('app.example.com {');
        const latest = (await createCaddyfileHistory(process.env.HISTORY_PATH).list('default'))[0];
        expect(latest.actor).toEqual(actor);
        expect(latest.action).toBe('route.add');
    });
});

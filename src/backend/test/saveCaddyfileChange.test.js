import { once } from 'node:events';
import { mkdtempSync, readdirSync } from 'fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createCaddyfileHistory } from '../src/caddyfileHistory.js';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { files, failWrites, live, caddyAdapt, caddyLoad, caddyGet, caddyPost, caddyPut } = vi.hoisted(() => ({
    files: new Map(),
    // Writes to fail, counted from 1 since the last reset
    failWrites: { at: [], count: 0 },
    // What the fake admin API serves: the loaded config, the HTTP servers and
    // objects added by @id
    live: { config: null, servers: null, objects: new Map() },
    caddyAdapt: vi.fn(),
    caddyLoad: vi.fn(),
    caddyGet: vi.fn(),
    caddyPost: vi.fn(),
    caddyPut: vi.fn(),
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
// Readback shares the fake admin API with every other read
vi.mock('../src/caddy.js', async importOriginal => ({ ...await importOriginal(), caddyAdapt, caddyLoad, caddyGet, caddyReadJson: caddyGet, caddyPost, caddyPut }));
// `caddy reload` and `caddy adapt` in a Docker-mode instance, against the fake
// files and admin API
const execInInstance = vi.hoisted(() => vi.fn());
vi.mock('../src/docker.js', async importOriginal => ({ ...await importOriginal(), getCaddyEnv: vi.fn(async () => ({})), execInInstance }));
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
const { readContainerFile } = await import('../src/containerFs.js');
const { default: logger } = await import('../src/logger.js');
const { firstDifference } = await import('../src/configVerification.js');
afterAll(async () => {
    await rm(process.env.HISTORY_PATH, { recursive: true, force: true });
    await rm(process.env.MAINTENANCE_PATH, { force: true });
    await rm(process.env.WWW_PATH, { recursive: true, force: true });
});

// Local mode (no container), so a failed /load has no binary fallback
const instance = { id: 'default', adminUrl: 'http://caddy:2019', configPath: '/etc/caddy/Caddyfile', containerName: '', serverName: 'srv0' };
const original = '{\n    admin :2019\n}\n\nold.example.com {\n}\n';
const historyFiles = () => readdirSync(process.env.HISTORY_PATH).filter(f => f.startsWith('Caddyfile-'));

// The fake adapter's JSON for a Caddyfile, and the admin API effects that
// readback verification checks
const adapted = async content => ({ adapted: content });
const load = async content => { live.config = await adapted(content); };
const addObject = async (path, body) => { live.objects.set(body['@id'], body); };
const verified = { file: 'verified', live: 'verified' };
const servers = { srv0: { listen: [':443'], routes: [] } };

beforeEach(() => {
    files.clear();
    files.set(instance.configPath, original);
    failWrites.at = [];
    failWrites.count = 0;
    live.config = null;
    live.servers = null;
    live.objects.clear();
    caddyAdapt.mockReset().mockImplementation(adapted);
    caddyLoad.mockReset().mockImplementation(load);
    caddyGet.mockReset().mockImplementation(async path => {
        if (path === '/config/') return live.config;
        if (path === '/config/apps/http/servers') return live.servers;
        const id = path.match(/^\/id\/(.+)$/)?.[1];
        if (id && live.objects.has(decodeURIComponent(id))) return live.objects.get(decodeURIComponent(id));
        throw Object.assign(new Error('Caddy API error: 404 unknown object ID'), { status: 404 });
    });
    caddyPost.mockReset().mockImplementation(addObject);
    execInInstance.mockReset().mockImplementation(async (container, cmd, args) => {
        const config = files.get(args[args.indexOf('--config') + 1]);
        if (args[0] === 'reload') {
            await load(config);
            return { stdout: '' };
        }
        if (args[0] === 'adapt') return { stdout: JSON.stringify(await adapted(config)) };
        return { stdout: '' };
    });
    caddyPut.mockReset().mockImplementation(async (path, body) => addObject(path, body[0]));
});

describe('saveCaddyfileChange', () => {
    it('runs asynchronous transforms against the preceding committed content inside the queue', async () => {
        let release, started;
        const gate = new Promise(resolve => { release = resolve; });
        const ready = new Promise(resolve => { started = resolve; });
        const firstActor = { type: 'user', id: randomUUID(), name: 'First actor' };
        const secondActor = { type: 'api-token', id: 'c'.repeat(32), name: 'Second actor' };
        const first = saveCaddyfileChange(instance, previous => previous + '\nfirst.example.com {}', {
            actor: firstActor, apply: async () => { started(); await gate; }, verify: async () => 'verified',
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
        const first = saveCaddyfileChange(instance, 'first committed content', { actor, apply: async () => { started(); await gate; }, verify: async () => 'verified' });
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
            const operation = saveCaddyfileChange(instance, 'saved despite history failure', { apply: afterApply ? block : caddyLoad, verify: async () => 'verified' });
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
        await expect(saveCaddyfileChange(instance, 'new.example.com {\n}\n')).resolves.toEqual({ applied: true, verification: verified });
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
        await expect(saveCaddyfileChange(instance, 'api.example.com {\n}\n', { apply, verify: async () => 'verified' })).rejects.toMatchObject({ code: 'CADDYFILE_CHANGE_REJECTED' });
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
        caddyLoad.mockImplementationOnce(async content => { await block(); await load(content); });
        caddyPost.mockImplementationOnce(async (path, route) => { await block(); await addObject(path, route); });
        live.servers = servers;
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
        caddyLoad.mockImplementationOnce(async content => { await rename(root, backup); await writeFile(root, 'blocked'); await load(content); });
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
        live.servers = servers;
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
        live.servers = servers;
        caddyPost.mockRejectedValue(new Error('Caddy API error: 400 invalid route'));
        const { status, body } = await send('POST', '/routes', { domain: 'app.example.com', upstream: 'app:3000' });
        expect(status).toBe(422);
        expect(body).toMatchObject({ code: 'CADDYFILE_CHANGE_REJECTED' });
        expect(files.get(instance.configPath)).toBe(original);
    });

    it("doesn't add a live route when the Caddyfile can't be written", async () => {
        live.servers = servers;
        failWrites.at = [1];
        const { status, body } = await send('POST', '/routes', { domain: 'app.example.com', upstream: 'app:3000' });
        expect(status).toBe(500);
        expect(body).toMatchObject({ code: 'CADDYFILE_WRITE_FAILED' });
        expect(caddyPost).not.toHaveBeenCalled();
        expect(files.get(instance.configPath)).toBe(original);
    });

    it('adds the route to the Caddyfile and to Caddy', async () => {
        live.servers = servers;
        expect((await send('POST', '/routes', { domain: 'app.example.com', upstream: 'app:3000',
            actor: { type: 'user', id: randomUUID(), name: 'Forged actor' } })).status).toBe(201);
        expect(caddyPost).toHaveBeenCalledTimes(1);
        expect(files.get(instance.configPath)).toContain('app.example.com {');
        const latest = (await createCaddyfileHistory(process.env.HISTORY_PATH).list('default'))[0];
        expect(latest.actor).toEqual(actor);
        expect(latest.action).toBe('route.add');
    });

    describe('readback verification', () => {
        const editorSave = content => send('PUT', '/caddyfile?fmt=false&sort=false', content);

        it('confirms the saved file and the running config', async () => {
            const { status, body } = await editorSave('verified.example.com {\n}\n');
            expect(status).toBe(200);
            expect(body).toEqual({ ok: true, message: 'Caddyfile saved and reloaded', verification: verified });
            expect(caddyAdapt).toHaveBeenLastCalledWith('verified.example.com {\n}\n', instance.adminUrl);
        });

        it('reports a file changed after the write without retrying or overwriting it', async () => {
            caddyLoad.mockImplementationOnce(async content => {
                await load(content);
                files.set(instance.configPath, 'external.example.com {\n}\n');
            });
            const { status, body } = await editorSave('mine.example.com {\n}\n');
            expect(status).toBe(200);
            expect(body).toMatchObject({ ok: true, warningCode: 'CONFIG_VERIFICATION_MISMATCH',
                verification: { file: 'mismatch', live: 'verified' } });
            expect(caddyLoad).toHaveBeenCalledTimes(1);
            expect(files.get(instance.configPath)).toBe('external.example.com {\n}\n');
        });

        it('reports a running config that differs from the saved Caddyfile', async () => {
            caddyLoad.mockImplementationOnce(async () => { live.config = { adapted: 'something else' }; });
            const { body } = await editorSave('mine.example.com {\n}\n');
            expect(body).toMatchObject({ ok: true, warningCode: 'CONFIG_VERIFICATION_MISMATCH',
                verification: { file: 'verified', live: 'mismatch' } });
            expect(caddyLoad).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['the running config', () => caddyGet.mockImplementationOnce(async () => { throw new Error('Caddy API error: 503 unavailable'); }), { file: 'verified', live: 'unavailable' }],
            // The first adapt validates the save; the second is the readback
            ['the adapter', () => caddyAdapt.mockImplementationOnce(adapted).mockRejectedValueOnce(new Error('adapt failed')), { file: 'verified', live: 'unavailable' }],
            ['the saved file', () => vi.mocked(readContainerFile)
                .mockImplementationOnce(async (container, path) => files.get(path))
                .mockRejectedValueOnce(new Error('EIO: i/o error')), { file: 'unavailable', live: 'verified' }],
        ])('distinguishes unreadable %s from a mismatch', async (name, fail, verification) => {
            fail();
            const { status, body } = await editorSave('mine.example.com {\n}\n');
            expect(status).toBe(200);
            expect(body).toMatchObject({ ok: true, warningCode: 'CONFIG_VERIFICATION_UNAVAILABLE', verification });
        });

        it('adapts with the caddy binary when that is how a Docker-mode instance reloaded', async () => {
            const docker = { ...instance, id: 'docker-mode', containerName: 'caddy' };
            caddyLoad.mockRejectedValueOnce(new Error('Caddy API error: 500 load failed'));
            const result = await saveCaddyfileChange(docker, 'binary.example.com {\n}\n');
            expect(result.verification).toEqual(verified);
            expect(execInInstance.mock.calls.map(([, , args]) => args[0])).toEqual(['reload', 'adapt']);
            expect(caddyAdapt).not.toHaveBeenCalled();
        });

        it('keeps a force-saved file Caddy rejected distinct from applied configuration', async () => {
            caddyLoad.mockRejectedValueOnce(new Error('Caddy API error: 400 loading config'));
            const { body } = await send('PUT', '/caddyfile?fmt=false&sort=false&validate=false', 'forced {\n}\n');
            expect(body.verification).toEqual({ file: 'verified', live: 'not-applied' });
            expect(body.warningCode).toBeUndefined();
            expect(caddyAdapt).not.toHaveBeenCalled();
        });

        it('puts a mismatch ahead of a history failure', async () => {
            const root = process.env.HISTORY_PATH, backup = root + '-backup';
            caddyLoad.mockImplementationOnce(async () => {
                await rename(root, backup);
                await writeFile(root, 'blocked');
                live.config = { adapted: 'something else' };
            });
            try {
                const { body } = await editorSave('mine.example.com {\n}\n');
                expect(body.warningCode).toBe('CONFIG_VERIFICATION_MISMATCH');
                expect(body.warning).toContain('history version could not be recorded');
            } finally {
                await rm(root, { force: true });
                await rename(backup, root);
            }
        });

        it('checks a route added through the admin API by its @id, not the whole config', async () => {
            live.servers = servers;
            const { status, body } = await send('POST', '/routes', { domain: 'app.example.com', upstream: 'app:3000' });
            expect(status).toBe(201);
            expect(body.verification).toEqual(verified);
            expect(caddyAdapt).not.toHaveBeenCalled();
            expect(caddyGet).toHaveBeenCalledWith(`/id/${body.id}`, instance.adminUrl);
        });

        it('reports an added route that the admin API serves differently', async () => {
            live.servers = servers;
            caddyPost.mockImplementationOnce(async (path, route) => addObject(path, { ...route, terminal: false }));
            const { body } = await send('POST', '/routes', { domain: 'app.example.com', upstream: 'app:3000' });
            expect(body).toMatchObject({ warningCode: 'CONFIG_VERIFICATION_MISMATCH', verification: { file: 'verified', live: 'mismatch' } });
        });

        it('reports an added route the admin API no longer has as a mismatch, not unavailable', async () => {
            live.servers = servers;
            caddyPost.mockImplementationOnce(async () => {});
            const { body } = await send('POST', '/routes', { domain: 'app.example.com', upstream: 'app:3000' });
            expect(body).toMatchObject({ warningCode: 'CONFIG_VERIFICATION_MISMATCH', verification: { file: 'verified', live: 'mismatch' } });
        });

        it('confirms admin-API-only route updates and deletions without claiming a file check', async () => {
            // Neither route has a host, so neither request touches the Caddyfile
            const [updatedId, deletedId] = ['route-admin-updated', 'route-admin-deleted'];
            const hostless = id => ({ '@id': id, match: [{ path: ['/'] }], handle: [] });
            live.objects.set(updatedId, hostless(updatedId));
            live.objects.set(deletedId, hostless(deletedId));
            live.servers = { srv0: { routes: [hostless(updatedId), hostless(deletedId)] } };
            const caddy = await import('../src/caddy.js');
            const patch = vi.spyOn(caddy, 'caddyPatch').mockImplementation(async (path, body) => { live.objects.set(updatedId, body); });
            const remove = vi.spyOn(caddy, 'caddyDelete').mockImplementation(async () => {
                live.objects.delete(deletedId);
                live.servers = { srv0: { routes: [hostless(updatedId)] } };
            });
            try {
                const updated = await send('PATCH', `/routes/${updatedId}`, { domain: 'app.example.com', upstream: 'app:3000' });
                expect(updated.body.verification).toEqual({ file: 'unchanged', live: 'verified' });
                const deleted = await send('DELETE', `/routes/${deletedId}`);
                expect(deleted.body.verification).toEqual({ file: 'unchanged', live: 'verified' });
                expect(files.get(instance.configPath)).toBe(original);
            } finally {
                patch.mockRestore();
                remove.mockRestore();
            }
        });

        it('verifies a reload from disk inside the change queue', async () => {
            let release;
            const gate = new Promise(resolve => { release = resolve; });
            const saving = saveCaddyfileChange(instance, 'queued.example.com {\n}\n', { apply: () => gate, verify: async () => 'verified' });
            const reloading = send('POST', '/caddyfile/reloads');
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(caddyLoad).not.toHaveBeenCalled();
            release();
            await saving;
            const { body } = await reloading;
            expect(caddyLoad).toHaveBeenCalledWith('queued.example.com {\n}\n', instance.adminUrl);
            expect(body.verification).toEqual({ file: 'unchanged', live: 'verified' });
        });

        it('never logs configuration text when a readback differs or fails', async () => {
            const warn = vi.spyOn(logger, 'warn');
            const secret = 'token-' + randomUUID();
            caddyLoad.mockImplementationOnce(async () => {
                live.config = { adapted: 'other', secret };
                files.set(instance.configPath, `external.example.com {\n\theader X-Secret ${secret}\n}\n`);
            });
            try {
                await editorSave(`mine.example.com {\n\theader X-Secret ${secret}\n}\n`);
                caddyGet.mockImplementationOnce(async () => { throw new Error(`Caddy API error: 500 ${secret}`); });
                await editorSave(`mine.example.com {\n\theader X-Secret ${secret}\n}\n`);
                const logged = JSON.stringify(warn.mock.calls);
                expect(logged).toContain('Configuration readback');
                expect(logged).not.toContain(secret);
            } finally { warn.mockRestore(); }
        });
    });
});

describe('firstDifference', () => {
    it('names the path of the first difference without values', () => {
        expect(firstDifference({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toBe('a.b[1]');
        expect(firstDifference({ a: 1 }, { a: 1, b: 2 })).toBe('b');
        expect(firstDifference([], {})).toBe('(root)');
        expect(firstDifference({ a: 1 }, { a: 1 })).toBeNull();
    });
});

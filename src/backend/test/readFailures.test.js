import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { caddyGet, instances } = vi.hoisted(() => ({ caddyGet: vi.fn(), instances: [] }));

vi.mock('../src/caddy.js', async importOriginal => ({ ...await importOriginal(), caddyGet }));
vi.mock('../src/instances.js', async importOriginal => ({ ...await importOriginal(), getInstances: () => instances }));
vi.mock('../src/caddyfileTitles.js', async importOriginal => ({ ...await importOriginal(), caddyfileTitlesEnabled: () => false }));

// These paths are read at import time
const root = await mkdtemp(join(tmpdir(), 'caddy-ui-read-failures-'));
const notesPath = join(root, 'route-notes.json');
const historyPath = join(root, 'history');
process.env.ROUTE_NOTES_PATH = notesPath;
process.env.HISTORY_PATH = historyPath;
const { default: logger } = await import('../src/logger.js');
const { default: routeNotesRouter, cleanupOrphanedNotes } = await import('../src/routes/routenotes.js');
const { default: caddyfileRouter } = await import('../src/routes/caddyfile.js');
const { checkCertsForInstance } = await import('../src/notifications.js');

const isRoot = process.getuid?.() === 0;
const servers = { srv0: { routes: [{ match: [{ host: ['app.example.com'] }] }] } };
let server;
let baseUrl;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', (req, res, next) => {
        req.instance = { id: 'default', adminUrl: 'http://caddy:2019', containerName: '', configPath: join(root, 'Caddyfile') };
        next();
    });
    app.use('/api/route-notes', routeNotesRouter);
    app.use('/api/caddyfile', caddyfileRouter);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
    await rm(notesPath, { force: true });
    caddyGet.mockReset();
    instances.splice(0, instances.length, { id: 'alpha', adminUrl: 'http://alpha:2019' }, { id: 'beta', adminUrl: 'http://beta:2019' });
});

afterEach(() => vi.restoreAllMocks());

const request = async (method, path, body) => {
    const res = await fetch(baseUrl + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
};

describe('route notes', () => {
    it('treats a missing notes file as no notes', async () => {
        expect(await request('GET', '/route-notes')).toEqual({ status: 200, body: {} });
    });

    it.each([
        ['corrupt', '{ not json'],
        ['not an object', '["app.example.com"]'],
    ])('reports a %s notes file and refuses to overwrite it', async (_, contents) => {
        await writeFile(notesPath, contents);
        expect(await request('GET', '/route-notes')).toMatchObject({ status: 500, body: { code: 'ROUTE_NOTES_READ_FAILED' } });
        expect(await request('PUT', '/route-notes/app.example.com', { note: 'new' })).toMatchObject({
            status: 500, body: { code: 'ROUTE_NOTES_READ_FAILED' },
        });
        expect(await readFile(notesPath, 'utf8')).toBe(contents);
    });

    it('keeps existing notes when adding one', async () => {
        await writeFile(notesPath, JSON.stringify({ 'other.example.com': 'kept' }));
        expect((await request('PUT', '/route-notes/app.example.com', { note: 'new' })).status).toBe(200);
        expect(JSON.parse(await readFile(notesPath, 'utf8'))).toEqual({ 'other.example.com': 'kept', 'app.example.com': 'new' });
    });

    it("doesn't prune notes while an instance's config can't be read", async () => {
        const notes = { 'app.example.com': 'alpha note', 'beta.example.com': 'beta note' };
        await writeFile(notesPath, JSON.stringify(notes));
        caddyGet.mockImplementation(async (path, adminUrl) => {
            if (adminUrl === 'http://beta:2019') throw new Error('connect ECONNREFUSED');
            return servers;
        });
        await cleanupOrphanedNotes();
        expect(JSON.parse(await readFile(notesPath, 'utf8'))).toEqual(notes);
    });

    it('prunes notes for domains no instance serves when every config is readable', async () => {
        await writeFile(notesPath, JSON.stringify({ 'app.example.com': 'kept', 'gone.example.com': 'removed' }));
        caddyGet.mockImplementation(async (path, adminUrl) => (adminUrl === 'http://alpha:2019' ? servers : null));
        await cleanupOrphanedNotes();
        expect(JSON.parse(await readFile(notesPath, 'utf8'))).toEqual({ 'app.example.com': 'kept' });
    });
});

describe('Caddyfile history list', () => {
    afterEach(() => chmod(historyPath, 0o755).catch(() => { }));

    it('lists snapshots', async () => {
        await mkdir(historyPath, { recursive: true });
        await writeFile(join(historyPath, 'Caddyfile-2026-10-18T12-00-00'), 'a {\n}\n');
        const { status, body } = await request('GET', '/caddyfile/history');
        expect(status).toBe(200);
        expect(body).toEqual([{ filename: 'Caddyfile-2026-10-18T12-00-00', timestamp: '2026-10-18T12:00:00' }]);
    });

    it.skipIf(isRoot)('reports an unreadable history directory instead of an empty list', async () => {
        await mkdir(historyPath, { recursive: true });
        await chmod(historyPath, 0o000);
        expect(await request('GET', '/caddyfile/history')).toMatchObject({
            status: 500, body: { code: 'CADDYFILE_HISTORY_READ_FAILED' },
        });
    });
});

describe('certificate expiry checks', () => {
    const inst = (dataPath) => ({ id: 'alpha', name: 'Alpha', containerName: '', dataPath });

    it('logs unreadable certificate storage once per outage', async () => {
        const warn = vi.spyOn(logger, 'warn');
        const info = vi.spyOn(logger, 'info');
        const missing = inst(join(root, 'missing-data'));

        await checkCertsForInstance(missing);
        await checkCertsForInstance(missing);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/Certificate expiry checks skipped/);

        await mkdir(join(root, 'missing-data', 'certificates'), { recursive: true });
        await checkCertsForInstance(missing);
        expect(info).toHaveBeenCalledWith('Certificate expiry checks resumed', { instance: 'Alpha' });
    });

    it("stays quiet before Caddy has stored a certificate", async () => {
        const warn = vi.spyOn(logger, 'warn');
        await mkdir(join(root, 'fresh-data'), { recursive: true });
        await checkCertsForInstance({ ...inst(join(root, 'fresh-data')), id: 'fresh' });
        expect(warn).not.toHaveBeenCalled();
    });
});

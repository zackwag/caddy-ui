import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearObservations } from '../src/observations.js';

const { caddyGet, instances } = vi.hoisted(() => ({ caddyGet: vi.fn(), instances: [] }));

vi.mock('../src/caddy.js', async importOriginal => ({ ...await importOriginal(), caddyGet }));
vi.mock('../src/instances.js', async importOriginal => ({ ...await importOriginal(), getInstances: () => instances }));
vi.mock('../src/caddyfileTitles.js', async importOriginal => ({ ...await importOriginal(), caddyfileTitlesEnabled: () => false }));

// ROUTE_NOTES_PATH is read at import time
const root = await mkdtemp(join(tmpdir(), 'caddy-ui-notes-'));
const notesPath = join(root, 'route-notes.json');
process.env.ROUTE_NOTES_PATH = notesPath;
const store = await import('../src/routeNotes.js');
const { default: routeNotesRouter, cleanupOrphanedNotes } = await import('../src/routes/routenotes.js');

const alpha = { id: 'alpha', adminUrl: 'http://alpha:2019' };
const beta = { id: 'beta', adminUrl: 'http://beta:2019' };
const serving = (...hosts) => ({ srv0: { routes: hosts.map(host => ({ match: [{ host: [host] }] })) } });
const saved = async () => JSON.parse(await readFile(notesPath, 'utf8'));
let server;
let baseUrl;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', (req, res, next) => {
        req.instance = instances.find(inst => inst.id === req.headers['x-instance-id']);
        next();
    });
    app.use('/api/route-notes', routeNotesRouter);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}/api/route-notes`;
});

afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
    clearObservations();
    await rm(notesPath, { force: true });
    instances.splice(0, instances.length, alpha, beta);
    // Both instances serve the same hostname
    caddyGet.mockReset().mockImplementation(async () => serving('app.example.com'));
});

const getNotes = async (instanceId) => (await fetch(baseUrl, { headers: { 'X-Instance-Id': instanceId } })).json();
const putNote = (instanceId, domain, note) => fetch(`${baseUrl}/${encodeURIComponent(domain)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Instance-Id': instanceId }, body: JSON.stringify({ note }),
});

describe('route notes per instance', () => {
    it('keeps a note written on one instance off another with the same hostname', async () => {
        expect((await putNote('alpha', 'app.example.com', 'Alpha app')).status).toBe(200);
        expect(await getNotes('alpha')).toEqual({ 'app.example.com': 'Alpha app' });
        expect(await getNotes('beta')).toEqual({});
    });

    it('clears only the selected instance’s note', async () => {
        await putNote('alpha', 'app.example.com', 'Alpha app');
        await putNote('beta', 'app.example.com', 'Beta app');
        await putNote('beta', 'app.example.com', '');
        expect(await getNotes('alpha')).toEqual({ 'app.example.com': 'Alpha app' });
        expect(await getNotes('beta')).toEqual({});
    });

    it('copies a note saved before notes were per instance to each instance serving its domain', async () => {
        await writeFile(notesPath, JSON.stringify({ 'app.example.com': 'Shared', 'gone.example.com': 'Old' }));
        expect(await getNotes('alpha')).toEqual({ 'app.example.com': 'Shared' });
        expect(await getNotes('beta')).toEqual({ 'app.example.com': 'Shared' });
        expect(await saved()).toEqual({
            version: 2,
            instances: { alpha: { 'app.example.com': 'Shared' }, beta: { 'app.example.com': 'Shared' } },
            unassigned: { 'gone.example.com': 'Old' },
        });
        // Each copy is now edited independently
        await putNote('alpha', 'app.example.com', 'Alpha only');
        expect(await getNotes('beta')).toEqual({ 'app.example.com': 'Shared' });
    });

    it('assigns an old note only to the instance serving its domain', async () => {
        caddyGet.mockImplementation(async (path, adminUrl) => (adminUrl === alpha.adminUrl ? serving('app.example.com') : serving('other.example.com')));
        await writeFile(notesPath, JSON.stringify({ 'app.example.com': 'Alpha app' }));
        expect(await getNotes('beta')).toEqual({});
        expect(await getNotes('alpha')).toEqual({ 'app.example.com': 'Alpha app' });
    });

    it("waits to assign old notes until every instance's config can be read", async () => {
        caddyGet.mockImplementation(async (path, adminUrl) => {
            if (adminUrl === beta.adminUrl) throw new Error('connect ECONNREFUSED');
            return serving('app.example.com');
        });
        await writeFile(notesPath, JSON.stringify({ 'app.example.com': 'Shared' }));
        expect(await getNotes('alpha')).toEqual({});
        expect(JSON.parse(await readFile(notesPath, 'utf8'))).toEqual({ 'app.example.com': 'Shared' });

        caddyGet.mockImplementation(async () => serving('app.example.com'));
        expect(await getNotes('alpha')).toEqual({ 'app.example.com': 'Shared' });
    });

    it("doesn't overwrite an instance's own note when assigning an old one", async () => {
        await writeFile(notesPath, JSON.stringify({ version: 2, instances: { alpha: { 'app.example.com': 'Mine' } }, unassigned: { 'app.example.com': 'Shared' } }));
        expect(await getNotes('alpha')).toEqual({ 'app.example.com': 'Mine' });
        expect(await getNotes('beta')).toEqual({ 'app.example.com': 'Shared' });
    });

    it("unassigns a removed instance's notes so a reused id doesn't get them", async () => {
        await putNote('beta', 'app.example.com', 'Beta app');
        await store.releaseInstanceNotes('beta');
        instances.splice(1, 1);
        caddyGet.mockImplementation(async (path, adminUrl) => (adminUrl === alpha.adminUrl ? serving('other.example.com') : serving('app.example.com')));
        expect(await getNotes('alpha')).toEqual({});
        expect((await saved()).unassigned).toEqual({ 'app.example.com': 'Beta app' });

        // A new instance with the same id that serves the domain picks it up by evidence, not by id
        instances.push({ ...beta, adminUrl: 'http://beta-new:2019' });
        expect(await getNotes('beta')).toEqual({ 'app.example.com': 'Beta app' });
    });

    it('prunes each instance only against its own routes', async () => {
        await putNote('alpha', 'app.example.com', 'Alpha app');
        await putNote('beta', 'app.example.com', 'Beta app');
        caddyGet.mockImplementation(async (path, adminUrl) => {
            if (adminUrl === beta.adminUrl) throw new Error('connect ECONNREFUSED');
            return serving('other.example.com');
        });
        await cleanupOrphanedNotes();
        expect((await saved()).instances).toEqual({ beta: { 'app.example.com': 'Beta app' } });
    });

    it('detects stored notes in either file format', async () => {
        expect(await store.hasStoredNotes()).toBe(false);
        await writeFile(notesPath, JSON.stringify({ 'app.example.com': 'Old' }));
        expect(await store.hasStoredNotes()).toBe(true);
        await writeFile(notesPath, JSON.stringify({ version: 2, instances: {}, unassigned: {} }));
        expect(await store.hasStoredNotes()).toBe(false);
        await writeFile(notesPath, JSON.stringify({ version: 2, instances: { alpha: { 'app.example.com': 'A' } }, unassigned: {} }));
        expect(await store.hasStoredNotes()).toBe(true);
    });

    it('serializes concurrent edits so none is lost', async () => {
        await Promise.all(['a', 'b', 'c', 'd'].map(n => putNote('alpha', `${n}.example.com`, n)));
        expect(Object.keys((await saved()).instances.alpha).sort()).toEqual(['a.example.com', 'b.example.com', 'c.example.com', 'd.example.com']);
    });
});

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { serve } from './fixtures/server.mjs';
import { markConfigChanged } from '../src/caddy.js';

const { caddyGet, instances, listed } = vi.hoisted(() => ({ caddyGet: vi.fn(), instances: [], listed: { complete: true } }));

vi.mock('../src/caddy.js', async importOriginal => ({ ...await importOriginal(), caddyGet }));
vi.mock('../src/instances.js', async importOriginal => ({ ...await importOriginal(), getInstances: () => [...instances], instancesComplete: () => listed.complete }));
vi.mock('../src/caddyfileTitles.js', async importOriginal => ({ ...await importOriginal(), caddyfileTitlesEnabled: () => false }));

const root = await mkdtemp(join(tmpdir(), 'caddy-ui-notes-'));
const notesPath = join(root, 'route-notes.json');
process.env.ROUTE_NOTES_PATH = notesPath;
const store = await import('../src/routeNotes.js');
const { default: routeNotesRouter } = await import('../src/routes/routenotes.js');
const { claimNotes, cleanupOrphanedNotes, retryNoteClaims } = await import('../src/noteOwners.js');

const alpha = { id: 'alpha', adminUrl: 'http://alpha:2019' };
const beta = { id: 'beta', adminUrl: 'http://beta:2019' };
const serving = (...hosts) => ({ srv0: { routes: hosts.map(host => ({ match: [{ host: [host] }] })) } });
const saved = async () => JSON.parse(await readFile(notesPath, 'utf8'));
// Notes are loaded at startup, and legacy notes assigned then and whenever an instance is saved.
const load = async contents => {
    await writeFile(notesPath, typeof contents === 'string' ? contents : JSON.stringify(contents));
    await store.loadRouteNotes();
};
const loadAndClaim = async contents => {
    await load(contents);
    await claimNotes();
};
let server;
let baseUrl;

beforeAll(async () => {
    server = await serve(app => {
        app.use('/api', (req, res, next) => {
            req.instance = instances.find(inst => inst.id === req.headers['x-instance-id']);
            next();
        });
        app.use('/api/route-notes', routeNotesRouter);
    });
    baseUrl = server.url + '/api/route-notes';
});

afterAll(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
    for (const inst of [alpha, beta]) markConfigChanged(inst.adminUrl);
    for (const name of await readdir(root)) await rm(join(root, name), { force: true });
    await store.loadRouteNotes();
    instances.splice(0, instances.length, alpha, beta);
    listed.complete = true;
    caddyGet.mockReset().mockImplementation(async () => serving('app.example.com'));
});

const getNotes = async (instanceId) => (await fetch(baseUrl, { headers: { 'X-Instance-Id': instanceId } })).json();
const putNote = (instanceId, domain, note) => fetch(`${baseUrl}/${encodeURIComponent(domain)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Instance-Id': instanceId }, body: JSON.stringify({ note }),
});

describe('route notes per instance', () => {
    it('treats a missing notes file as no notes', async () => {
        expect(await getNotes('alpha')).toEqual({});
    });

    it.each([
        ['corrupt', '{ not json'],
        ['not an object', '["app.example.com"]'],
    ])('sets aside a %s notes file instead of overwriting it', async (_, contents) => {
        await load(contents);
        expect(await getNotes('alpha')).toEqual({});
        expect((await putNote('alpha', 'app.example.com', 'new')).status).toBe(200);
        const [aside] = (await readdir(root)).filter(name => name.startsWith('route-notes.json.corrupt-'));
        expect(await readFile(join(root, aside), 'utf8')).toBe(contents);
        expect((await saved()).instances).toEqual({ alpha: { 'app.example.com': 'new' } });
    });

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
        await loadAndClaim({ 'app.example.com': 'Shared', 'gone.example.com': 'Old' });
        expect(await getNotes('alpha')).toEqual({ 'app.example.com': 'Shared' });
        expect(await getNotes('beta')).toEqual({ 'app.example.com': 'Shared' });
        expect(await saved()).toEqual({
            version: 2,
            instances: { alpha: { 'app.example.com': 'Shared' }, beta: { 'app.example.com': 'Shared' } },
            unassigned: { 'gone.example.com': 'Old' },
        });
        await putNote('alpha', 'app.example.com', 'Alpha only');
        expect(await getNotes('beta')).toEqual({ 'app.example.com': 'Shared' });
    });

    it('assigns an old note only to the instance serving its domain', async () => {
        caddyGet.mockImplementation(async (path, adminUrl) => (adminUrl === alpha.adminUrl ? serving('app.example.com') : serving('other.example.com')));
        await loadAndClaim({ 'app.example.com': 'Alpha app' });
        expect(await getNotes('beta')).toEqual({});
        expect(await getNotes('alpha')).toEqual({ 'app.example.com': 'Alpha app' });
    });

    it("waits to assign old notes until every instance's config can be read", async () => {
        caddyGet.mockImplementation(async (path, adminUrl) => {
            if (adminUrl === beta.adminUrl) throw new Error('connect ECONNREFUSED');
            return serving('app.example.com');
        });
        await loadAndClaim({ 'app.example.com': 'Shared' });
        expect(await getNotes('alpha')).toEqual({});
        expect(JSON.parse(await readFile(notesPath, 'utf8'))).toEqual({ 'app.example.com': 'Shared' });

        // Only the unreadable instance's next round retries it, reading only that instance
        caddyGet.mockImplementation(async () => serving('app.example.com'));
        expect(retryNoteClaims('alpha')).toBeUndefined();
        caddyGet.mockClear();
        await retryNoteClaims('beta');
        expect(caddyGet.mock.calls.map(([, adminUrl]) => adminUrl)).toEqual([beta.adminUrl]);
        expect(await getNotes('alpha')).toEqual({ 'app.example.com': 'Shared' });
    });

    it('does not retry a claim that read every instance and matched nothing', async () => {
        caddyGet.mockImplementation(async () => serving('other.example.com'));
        await loadAndClaim({ 'app.example.com': 'Shared' });
        caddyGet.mockImplementation(async () => serving('app.example.com'));
        for (const inst of [alpha, beta]) markConfigChanged(inst.adminUrl);
        for (const { id } of [alpha, beta]) {
            expect(retryNoteClaims(id)).toBeUndefined();
        }
        expect(await getNotes('alpha')).toEqual({});
        // An instance save still tries again
        await claimNotes();
        expect(await getNotes('alpha')).toEqual({ 'app.example.com': 'Shared' });
    });

    it("doesn't overwrite an instance's own note when assigning an old one", async () => {
        await loadAndClaim({ version: 2, instances: { alpha: { 'app.example.com': 'Mine' } }, unassigned: { 'app.example.com': 'Shared' } });
        expect(await getNotes('alpha')).toEqual({ 'app.example.com': 'Mine' });
        expect(await getNotes('beta')).toEqual({ 'app.example.com': 'Shared' });
    });

    it("unassigns a removed instance's notes so a reused id doesn't get them", async () => {
        await putNote('beta', 'app.example.com', 'Beta app');
        await store.releaseInstanceNotes('beta');
        instances.splice(1, 1);
        caddyGet.mockImplementation(async (path, adminUrl) => (adminUrl === alpha.adminUrl ? serving('other.example.com') : serving('app.example.com')));
        await claimNotes();
        expect(await getNotes('alpha')).toEqual({});
        expect((await saved()).unassigned).toEqual({ 'app.example.com': 'Beta app' });

        // A new instance with the same id that serves the domain picks it up by evidence, not by id
        instances.push({ ...beta, adminUrl: 'http://beta-new:2019' });
        await claimNotes();
        expect(await getNotes('beta')).toEqual({ 'app.example.com': 'Beta app' });
    });

    it('prunes each instance only against its own routes, keeping unassigned notes while any config is unreadable', async () => {
        await load({ version: 2,
            instances: { alpha: { 'app.example.com': 'Alpha app' }, beta: { 'app.example.com': 'Beta app' } },
            unassigned: { 'gone.example.com': 'Old' } });
        caddyGet.mockImplementation(async (path, adminUrl) => {
            if (adminUrl === beta.adminUrl) throw new Error('connect ECONNREFUSED');
            return serving('other.example.com');
        });
        await cleanupOrphanedNotes();
        expect(await saved()).toEqual({ version: 2, instances: { beta: { 'app.example.com': 'Beta app' } }, unassigned: { 'gone.example.com': 'Old' } });
    });

    it('prunes old notes for domains no instance serves once every config is readable', async () => {
        await load({ 'app.example.com': 'kept', 'gone.example.com': 'removed' });
        caddyGet.mockImplementation(async (path, adminUrl) => (adminUrl === alpha.adminUrl ? serving('app.example.com') : null));
        await cleanupOrphanedNotes();
        expect(await saved()).toEqual({ version: 2, instances: { alpha: { 'app.example.com': 'kept' } }, unassigned: {} });
    });

    it('detects stored notes in either file format', async () => {
        expect(store.hasStoredNotes()).toBe(false);
        await load({ 'app.example.com': 'Old' });
        expect(store.hasStoredNotes()).toBe(true);
        await load({ version: 2, instances: {}, unassigned: {} });
        expect(store.hasStoredNotes()).toBe(false);
        await load({ version: 2, instances: { alpha: { 'app.example.com': 'A' } }, unassigned: {} });
        expect(store.hasStoredNotes()).toBe(true);
    });

    it('serializes concurrent edits so none is lost', async () => {
        await Promise.all(['a', 'b', 'c', 'd'].map(n => putNote('alpha', `${n}.example.com`, n)));
        expect(Object.keys((await saved()).instances.alpha).sort()).toEqual(['a.example.com', 'b.example.com', 'c.example.com', 'd.example.com']);
    });

    it("doesn't hold up note edits while a claim waits on an instance", async () => {
        const hung = Promise.withResolvers();
        caddyGet.mockImplementation(async (path, adminUrl) => (adminUrl === beta.adminUrl ? hung.promise : serving('app.example.com')));
        await load({ 'app.example.com': 'Shared' });
        const claim = claimNotes();
        expect((await putNote('alpha', 'other.example.com', 'Edited')).status).toBe(200);
        hung.resolve(serving('app.example.com'));
        await claim;
        expect(await getNotes('alpha')).toEqual({ 'other.example.com': 'Edited', 'app.example.com': 'Shared' });
    });

    it("doesn't give notes to an instance removed while a claim read its config", async () => {
        const hung = Promise.withResolvers();
        caddyGet.mockImplementation(async (path, adminUrl) => (adminUrl === alpha.adminUrl ? hung.promise : serving('app.example.com')));
        await load({ 'app.example.com': 'Shared' });
        const claim = claimNotes();
        instances.splice(1, 1);
        await store.releaseInstanceNotes('beta');
        hung.resolve(serving('other.example.com'));
        await claim;
        expect(store.hasUnassignedNotes()).toBe(true);
        // A new instance reusing the id doesn't inherit them
        instances.push({ ...beta, adminUrl: 'http://beta-new:2019' });
        expect(await getNotes('beta')).toEqual({});
    });

    it('neither assigns nor prunes old notes while an instances entry is ignored', async () => {
        listed.complete = false;
        await load({ 'app.example.com': 'Shared', 'gone.example.com': 'Old' });
        await cleanupOrphanedNotes();
        expect(await getNotes('alpha')).toEqual({});
        expect(await saved()).toEqual({ 'app.example.com': 'Shared', 'gone.example.com': 'Old' });
    });
});

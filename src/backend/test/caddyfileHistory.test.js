import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCaddyfileHistory } from '../src/caddyfileHistory.js';

const io = vi.hoisted(() => ({ readFile: vi.fn(), stat: vi.fn() }));
vi.mock('node:fs/promises', async original => {
    const fs = await original();
    io.readFile.mockImplementation(fs.readFile);
    io.stat.mockImplementation(fs.stat);
    return { ...fs, ...io };
});

const directories = [];
async function fixture(options = {}) {
    const root = await mkdtemp(join(tmpdir(), 'caddy-history-'));
    directories.push(root);
    return { root, history: createCaddyfileHistory(root, options) };
}
afterEach(async () => { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const user = () => ({ type: 'user', id: randomUUID(), name: 'Administrator' });

describe('committed Caddyfile history', () => {
    it('preserves a baseline and commits the saved content with an identity reference', async () => {
        const { root, history } = await fixture();
        const actor = user();
        await history.preserve('default', 'before');
        const filename = await history.record('default', 'after', { actor, action: 'caddyfile.save', outcome: 'applied' });
        const entries = await history.list('default');
        expect(entries).toHaveLength(2);
        expect(entries[0]).toMatchObject({ filename, actor, action: 'caddyfile.save', outcome: 'applied', parent: entries[1].filename });
        expect(entries[1]).toMatchObject({ actor: null, outcome: 'unknown', parent: null });
        const stored = JSON.parse(await readFile(join(root, filename), 'utf8'));
        expect(stored.content).toBe('after');
        expect(stored.actor).toEqual({ type: actor.type, id: actor.id });
        expect(JSON.stringify(stored)).not.toContain(actor.name);
        await history.preserve('default', 'after');
        expect(await history.list('default')).toHaveLength(2);
    });

    it('resolves current names without rewriting versions and retains revoked token attribution', async () => {
        const { root, history } = await fixture();
        const actor = { type: 'api-token', id: 'a'.repeat(32), name: 'Automation' };
        const filename = await history.record('default', 'config', { actor, outcome: 'applied' });
        const before = await readFile(join(root, filename), 'utf8');
        expect((await history.list('default', ref => ({ ...ref, name: 'Renamed automation' })))[0].actor.name).toBe('Renamed automation');
        expect(await readFile(join(root, filename), 'utf8')).toBe(before);
        expect((await history.list('default', () => null))[0].actor).toEqual(actor);
    });

    it('preserves external content as unknown rather than attributing it to the next administrator', async () => {
        const { history } = await fixture();
        await history.record('default', 'saved', { actor: user(), outcome: 'applied' });
        await history.preserve('default', 'external edit');
        const entries = await history.list('default');
        expect(entries[0].actor).toBeNull();
        expect((await history.read('default', entries[0].filename)).content).toBe('external edit');
        expect(entries[1].actor.type).toBe('user');
    });

    it('reads legacy plain snapshots without inventing attribution', async () => {
        const { root, history } = await fixture();
        const filename = 'Caddyfile-2026-10-18T12-00-00';
        await writeFile(join(root, filename), '{\n admin :2019\n}\n');
        expect((await history.list('default'))[0]).toMatchObject({ filename, timestamp: '2026-10-18T12:00:00Z', actor: null });
        expect((await history.read('default', filename)).content).toBe('{\n admin :2019\n}\n');
        expect(history.validFilename('../actors.json')).toBe(false);
        expect(history.validFilename('actors.json')).toBe(false);
    });

    it('keeps ordered immutable versions for rapid saves and prunes to the configured limit', async () => {
        const { root, history } = await fixture({ now: () => 100000, limit: 3 });
        const names = [];
        for (let i = 0; i < 5; i++) names.push(await history.record('default', String(i)));
        expect(new Set(names).size).toBe(5);
        const entries = await history.list('default');
        expect(entries.map(entry => entry.filename)).toEqual(names.slice(2).reverse());
        expect((await history.read('default', entries[0].filename)).content).toBe('4');
        expect((await readdir(root)).some(name => name.endsWith('.tmp'))).toBe(false);
    });

    it('isolates instance versions while preserving concurrently registered identities', async () => {
        const { history } = await fixture();
        const first = user(), second = user();
        await Promise.all([
            history.record('one', 'one', { actor: first }), history.record('two', 'two', { actor: second }),
        ]);
        expect((await history.list('one'))[0].actor).toEqual(first);
        expect((await history.list('two'))[0].actor).toEqual(second);
        expect(await history.list('default')).toEqual([]);
    });

    it('skips corrupt versions without inventing attribution or blocking future records', async () => {
        const { root, history } = await fixture();
        const valid = await history.record('default', 'valid config');
        const filename = await history.record('default', 'config');
        await writeFile(join(root, filename), '{');
        expect((await history.list('default')).map(entry => entry.filename)).toEqual([valid]);
        await history.preserve('default', 'external edit');
        await history.record('default', 'new config', { actor: user(), outcome: 'applied' });
        const entries = await history.list('default');
        expect(entries).toHaveLength(3);
        expect(entries[1].actor).toBeNull();
        expect((await history.read('default', entries[1].filename)).content).toBe('external edit');
    });

    it('continues listing and recording when the identity registry is corrupt', async () => {
        const { root, history } = await fixture();
        const actor = user();
        await history.record('default', 'first', { actor });
        await writeFile(join(root, 'actors.json'), '{');
        const restarted = createCaddyfileHistory(root);
        expect((await restarted.list('default', ref => ({ ...ref, name: 'Current administrator' })))[0].actor.name).toBe('Current administrator');
        await restarted.record('default', 'second', { actor });
        expect((await restarted.list('default'))[0].actor).toEqual(actor);
    });

    it('keeps other versions when pruning removes one between directory listing and metadata lookup', async () => {
        const { root, history } = await fixture();
        await history.record('default', 'first');
        const newest = await history.record('default', 'second');
        io.stat.mockImplementationOnce(async path => { await rm(path); return { mtimeMs: 1, ctimeMs: 1, size: 1 }; });
        const entries = await history.list('default');
        expect(entries).toHaveLength(1);
        expect(entries[0].filename).not.toBe(newest);
        expect(await readdir(root)).toHaveLength(1);
    });

    it('reuses metadata and identity caches instead of rereading all snapshot contents', async () => {
        const { history } = await fixture();
        await history.record('default', 'first', { actor: user() });
        await history.record('default', 'second', { actor: user() });
        await history.list('default');
        io.readFile.mockClear();
        expect(await history.list('default')).toHaveLength(2);
        expect(io.readFile).not.toHaveBeenCalled();
    });
});

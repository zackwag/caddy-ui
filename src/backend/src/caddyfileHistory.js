import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import logger from './logger.js';

const FILENAME = /^Caddyfile-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3})Z-[a-f0-9-]+\.json)?$/;
const validActor = actor => actor && ['user', 'api-token'].includes(actor.type)
    && typeof actor.id === 'string' && /^[a-f0-9-]{32,36}$/.test(actor.id);

async function atomicJson(directory, filename, value) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.history-${randomUUID()}.tmp`);
    let handle;
    try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(JSON.stringify(value) + '\n');
        await handle.sync();
        await handle.close();
        handle = null;
        await rename(temporary, join(directory, filename));
    } finally {
        if (handle) await handle.close();
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') logger.warn('Could not remove temporary history file', { code: error.code }); });
    }
}

// Content and attribution are published together. Older plain Caddyfile backups
// stay readable and are never assigned an identity retroactively.
export function createCaddyfileHistory(root, { limit = 20, now = Date.now } = {}) {
    let actorWrites = Promise.resolve();
    const directory = id => id && id !== 'default' ? join(root, id) : root;
    const validFilename = filename => FILENAME.test(filename);
    async function filenames(id) {
        try { return (await readdir(directory(id))).filter(validFilename).sort().reverse(); }
        catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    }
    async function registry() {
        try {
            const value = JSON.parse(await readFile(join(root, 'actors.json'), 'utf8'));
            if (value.version !== 1 || !value.actors || typeof value.actors !== 'object' || Array.isArray(value.actors)
                || !Object.entries(value.actors).every(([key, actor]) => validActor(actor)
                    && key === `${actor.type}:${actor.id}` && typeof actor.name === 'string'
                    && actor.name.trim() && actor.name.length <= 128)) throw new Error('Invalid history identity registry');
            return value;
        } catch (error) { if (error.code === 'ENOENT') return { version: 1, actors: {} }; throw error; }
    }
    async function remember(actor) {
        if (!validActor(actor) || typeof actor.name !== 'string' || !actor.name.trim() || actor.name.length > 128) return null;
        const reference = { type: actor.type, id: actor.id };
        const operation = actorWrites.then(async () => {
            const value = await registry();
            const key = `${actor.type}:${actor.id}`;
            if (value.actors[key]?.name === actor.name) return;
            value.actors[key] = { ...reference, name: actor.name };
            await atomicJson(root, 'actors.json', value);
        });
        actorWrites = operation.catch(() => {});
        await operation;
        return reference;
    }
    async function read(id, filename) {
        const match = FILENAME.exec(filename);
        if (!match) throw new Error('Invalid history filename');
        const raw = await readFile(join(directory(id), filename), 'utf8');
        if (!filename.endsWith('.json')) return { version: 0, content: raw, actor: null, parent: null,
            action: null, outcome: 'unknown', timestamp: `${match[1]}T${match[2]}:${match[3]}:${match[4]}Z` };
        const value = JSON.parse(raw);
        if (value.version !== 1 || typeof value.content !== 'string' || typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp))
            || !['applied', 'saved-unapplied', 'unknown'].includes(value.outcome)
            || (value.actor !== null && !validActor(value.actor))
            || (value.action !== null && typeof value.action !== 'string')
            || (value.parent !== null && !validFilename(value.parent))) throw new Error('Invalid history version');
        return value;
    }
    async function record(id, content, { actor = null, action = null, outcome = 'unknown' } = {}) {
        const previous = (await filenames(id))[0] || null;
        const last = previous ? await read(id, previous) : null;
        // Keep ordering deterministic even for several saves in one millisecond
        // or a clock adjustment, without overwriting any existing version.
        const timestamp = new Date(Math.max(now(), last ? Date.parse(last.timestamp) + 1 : 0)).toISOString();
        const filename = `Caddyfile-${timestamp.replace(/[:.]/g, '-')}-${randomUUID()}.json`;
        const reference = await remember(actor);
        await atomicJson(directory(id), filename, { version: 1, timestamp, parent: previous, actor: reference, action, outcome, content });
        try {
            for (const name of (await filenames(id)).slice(limit)) await unlink(join(directory(id), name));
        } catch (error) { logger.warn('Could not prune Caddyfile history', { instanceId: id, code: error.code }); }
        return filename;
    }
    return {
        directory, validFilename, read, record,
        async preserve(id, content) {
            if (content === null) return;
            const latest = (await filenames(id))[0];
            if (!latest || (await read(id, latest)).content !== content) await record(id, content);
        },
        async list(id, resolve = () => null) {
            const identities = await registry();
            return Promise.all((await filenames(id)).map(async filename => {
                const value = await read(id, filename);
                const entry = { timestamp: value.timestamp, parent: value.parent, actor: value.actor, action: value.action, outcome: value.outcome };
                if (entry.actor) entry.actor = resolve(entry.actor)
                    || identities.actors[`${entry.actor.type}:${entry.actor.id}`] || { ...entry.actor, name: null };
                return { filename, ...entry };
            }));
        },
        async remove(id, filename) {
            if (!validFilename(filename)) throw new Error('Invalid history filename');
            await unlink(join(directory(id), filename));
        },
    };
}

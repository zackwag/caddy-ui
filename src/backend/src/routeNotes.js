import { readFile, writeFile } from 'fs/promises';
import { AppError } from './AppError.js';
import logger from './logger.js';

const ROUTE_NOTES_PATH = process.env.ROUTE_NOTES_PATH || '/etc/caddy-ui/route-notes.json';
const STATE_VERSION = 2;

// Version 2: { version, instances: { instanceId: { domain: note } }, unassigned: { domain: note } }.
// Version 1 was { domain: note } shared by every instance, so its notes have
// no recorded owner and load as unassigned. A domain key may list several
// hosts ("a.example.com, b.example.com").

let _writeLock = Promise.resolve();

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const readFailed = (cause) => new AppError('ROUTE_NOTES_READ_FAILED', { cause, context: { path: ROUTE_NOTES_PATH } });

function notesOnly(entries) {
    return Object.fromEntries(Object.entries(isObject(entries) ? entries : {}).filter(([, note]) => typeof note === 'string'));
}

// The file is read on every call, so manual edits apply without a restart. A
// missing file means no notes yet; an unreadable or corrupt file throws, so
// it's never treated as empty and then overwritten.
async function readStore() {
    let data;
    try {
        data = await readFile(ROUTE_NOTES_PATH, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return { instances: {}, unassigned: {} };
        throw readFailed(err);
    }
    let parsed;
    try {
        parsed = JSON.parse(data);
    } catch (err) {
        throw readFailed(err);
    }
    if (!isObject(parsed)) throw readFailed();
    if (parsed.version !== STATE_VERSION) return { instances: {}, unassigned: notesOnly(parsed) };
    const instances = {};
    for (const [id, entries] of Object.entries(isObject(parsed.instances) ? parsed.instances : {})) instances[id] = notesOnly(entries);
    return { instances, unassigned: notesOnly(parsed.unassigned) };
}

async function writeStore(store) {
    for (const [id, entries] of Object.entries(store.instances)) {
        if (!Object.keys(entries).length) delete store.instances[id];
    }
    await writeFile(ROUTE_NOTES_PATH, JSON.stringify({ version: STATE_VERSION, ...store }, null, 2), 'utf8');
}

// Serializes read-modify-write cycles so concurrent edits don't drop each other
function update(change) {
    const run = _writeLock.then(async () => {
        const store = await readStore();
        if (await change(store) !== false) await writeStore(store);
    });
    _writeLock = run.catch(() => { });
    return run;
}

export async function getInstanceNotes(instanceId) {
    const store = await readStore();
    return { ...(store.instances[instanceId] || {}) };
}

export async function hasUnassignedNotes() {
    return Object.keys((await readStore()).unassigned).length > 0;
}

// Whether any note is stored, in either format. Unreadable counts as none,
// matching how Caddyfile title detection treated it before.
export async function hasStoredNotes() {
    try {
        const store = await readStore();
        return Object.keys(store.unassigned).length > 0
            || Object.values(store.instances).some(entries => Object.keys(entries).length > 0);
    } catch {
        return false;
    }
}

export function setInstanceNote(instanceId, domain, note) {
    return update(store => {
        const entries = { ...(store.instances[instanceId] || {}) };
        if (note) entries[domain] = note;
        else delete entries[domain];
        store.instances[instanceId] = entries;
    });
}

// A removed instance's notes become unassigned, so a new instance reusing its
// id doesn't inherit them, while an instance that serves the same hosts can
// still pick them up.
export function releaseInstanceNotes(instanceId) {
    return update(store => {
        const entries = store.instances[instanceId];
        if (!entries) return false;
        for (const [domain, note] of Object.entries(entries)) {
            if (!(domain in store.unassigned)) store.unassigned[domain] = note;
        }
        delete store.instances[instanceId];
    });
}

const servedBy = (hosts, domain) => hosts && domain.split(', ').some(host => hosts.has(host));

// Gives each unassigned note to every instance that currently serves its
// domain. Before notes were per instance, a note showed on all of those
// instances, so copying keeps what each one displayed without picking an
// owner. hostsFor(instance) resolves to the hosts the instance serves, or null
// when its config can't be read; nothing is assigned until every instance can
// be read. Notes no instance serves stay unassigned for pruneOrphanedNotes.
export function claimUnassignedNotes(instances, hostsFor) {
    return update(async store => {
        if (!Object.keys(store.unassigned).length) return false;
        const hosts = await Promise.all(instances.map(hostsFor));
        if (hosts.includes(null)) return false;
        let claimed = false;
        for (const [domain, note] of Object.entries(store.unassigned)) {
            const owners = instances.filter((_, i) => servedBy(hosts[i], domain));
            if (!owners.length) continue;
            for (const inst of owners) {
                store.instances[inst.id] = { [domain]: note, ...(store.instances[inst.id] || {}) };
            }
            delete store.unassigned[domain];
            claimed = true;
            logger.info('Assigned a route note saved before notes were per instance', { domain, instances: owners.map(inst => inst.id) });
        }
        return claimed;
    });
}

// Removes notes for domains their instance no longer serves. An instance whose
// config can't be read keeps all of its notes, and unassigned notes are only
// removed when every instance could be read.
export function pruneOrphanedNotes(instances, hostsFor) {
    return update(async store => {
        const hosts = new Map(await Promise.all(instances.map(async inst => [inst.id, await hostsFor(inst)])));
        const removed = [];
        for (const [id, entries] of Object.entries(store.instances)) {
            if (!hosts.has(id) || !hosts.get(id)) continue;
            for (const domain of Object.keys(entries)) {
                if (!servedBy(hosts.get(id), domain)) {
                    delete entries[domain];
                    removed.push(`${id}:${domain}`);
                }
            }
        }
        const unreadable = [...hosts].filter(([, served]) => !served).map(([id]) => id);
        if (!unreadable.length) {
            for (const domain of Object.keys(store.unassigned)) {
                if (![...hosts.values()].some(served => servedBy(served, domain))) {
                    delete store.unassigned[domain];
                    removed.push(domain);
                }
            }
        } else {
            logger.warn('Route notes cleanup skipped instances whose Caddy config is unavailable', { instances: unreadable });
        }
        if (!removed.length) return false;
        logger.info('Cleaned up orphaned route notes', { removed: removed.length });
    });
}

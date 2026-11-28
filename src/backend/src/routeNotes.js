import { getInstances } from './instances.js';
import { CorruptJsonError, createJsonStore } from './jsonFile.js';
import logger from './logger.js';

const ROUTE_NOTES_PATH = process.env.ROUTE_NOTES_PATH || '/etc/caddy-ui/route-notes.json';
const STATE_VERSION = 2;

// Version 2: { version, instances: { instanceId: { domain: note } }, unassigned: { domain: note } }.
// Version 1 was { domain: note } shared by every instance, so its notes have
// no recorded owner and load as unassigned. A domain key may list several
// hosts ("a.example.com, b.example.com").

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

function notesOnly(entries) {
    return Object.fromEntries(Object.entries(isObject(entries) ? entries : {}).filter(([, note]) => typeof note === 'string'));
}

// A missing file means no notes yet. A file that isn't an object is set aside
// rather than overwritten.
function parseNotes(parsed) {
    if (parsed === undefined) return { instances: {}, unassigned: {} };
    if (!isObject(parsed)) {
        throw new CorruptJsonError(ROUTE_NOTES_PATH, new TypeError('Route notes must be a JSON object'));
    }
    if (parsed.version !== STATE_VERSION) return { instances: {}, unassigned: notesOnly(parsed) };
    const instances = {};
    for (const [id, entries] of Object.entries(isObject(parsed.instances) ? parsed.instances : {})) instances[id] = notesOnly(entries);
    return { instances, unassigned: notesOnly(parsed.unassigned) };
}

const store = createJsonStore(ROUTE_NOTES_PATH, {
    parse: parseNotes,
    serialize: ({ instances, unassigned }) => ({
        version: STATE_VERSION,
        instances: Object.fromEntries(Object.entries(instances).filter(([, entries]) => Object.keys(entries).length)),
        unassigned,
    }),
});

export function loadRouteNotes() {
    return store.load();
}

export function getInstanceNotes(instanceId) {
    return { ...(store.get().instances[instanceId] || {}) };
}

export function hasUnassignedNotes() {
    return Object.keys(store.get().unassigned).length > 0;
}

// Whether any note is stored, in either format.
export function hasStoredNotes() {
    const { instances, unassigned } = store.get();
    return Object.keys(unassigned).length > 0
        || Object.values(instances).some(entries => Object.keys(entries).length > 0);
}

export function setInstanceNote(instanceId, domain, note) {
    return store.update(state => {
        const entries = { ...(state.instances[instanceId] || {}) };
        if (note) entries[domain] = note;
        else delete entries[domain];
        state.instances[instanceId] = entries;
    });
}

// A removed instance's notes become unassigned, so a new instance reusing its
// id doesn't inherit them, while an instance that serves the same hosts can
// still pick them up.
export function releaseInstanceNotes(instanceId) {
    return store.update(state => {
        const entries = state.instances[instanceId];
        if (!entries) return false;
        for (const [domain, note] of Object.entries(entries)) {
            if (!(domain in state.unassigned)) state.unassigned[domain] = note;
        }
        delete state.instances[instanceId];
    });
}

const servedBy = (hosts, domain) => hosts && domain.split(', ').some(host => hosts.has(host));

// Gives each unassigned note to every instance that currently serves its
// domain. Before notes were per instance, a note showed on all of those
// instances, so copying keeps what each one displayed without picking an
// owner. hosts[i] is the set of hosts instances[i] serves; the caller reads
// them all first, outside the queue, and assigns nothing unless every
// instance could be read. Notes no instance serves stay unassigned for
// pruneOrphanedNotes. An instance removed since its hosts were read gets
// nothing, since its notes were released.
export function claimUnassignedNotes(instances, hosts) {
    return store.update(state => {
        const current = new Set(getInstances().map(inst => inst.id));
        let claimed = false;
        for (const [domain, note] of Object.entries(state.unassigned)) {
            const owners = instances.filter((inst, i) => current.has(inst.id) && servedBy(hosts[i], domain));
            if (!owners.length) continue;
            for (const inst of owners) {
                state.instances[inst.id] = { [domain]: note, ...(state.instances[inst.id] || {}) };
            }
            delete state.unassigned[domain];
            claimed = true;
            logger.info('Assigned a route note saved before notes were per instance', { domain, instances: owners.map(inst => inst.id) });
        }
        return claimed ? undefined : false;
    });
}

// Removes notes for domains their instance no longer serves. hosts[i] is what
// instances[i] serves, or null when its config couldn't be read; such an
// instance keeps all of its notes. Unassigned notes are only removed when
// every instance could be read and `complete` says the list has them all.
export function pruneOrphanedNotes(instances, hosts, { complete }) {
    return store.update(state => {
        const served = new Map(instances.map((inst, i) => [inst.id, hosts[i]]));
        const removed = [];
        for (const [id, entries] of Object.entries(state.instances)) {
            if (!served.get(id)) continue;
            for (const domain of Object.keys(entries)) {
                if (!servedBy(served.get(id), domain)) {
                    delete entries[domain];
                    removed.push(`${id}:${domain}`);
                }
            }
        }
        const unreadable = [...served].filter(([, hostSet]) => !hostSet).map(([id]) => id);
        if (!unreadable.length && complete) {
            for (const domain of Object.keys(state.unassigned)) {
                if (![...served.values()].some(hostSet => servedBy(hostSet, domain))) {
                    delete state.unassigned[domain];
                    removed.push(domain);
                }
            }
        } else {
            logger.warn('Route notes cleanup kept unassigned notes: not every instance could be read', { instances: unreadable, instancesComplete: complete });
        }
        if (!removed.length) return false;
        logger.info('Cleaned up orphaned route notes', { removed: removed.length });
    });
}

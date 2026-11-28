import { createJsonStore, readJsonState } from './jsonFile.js';
import logger from './logger.js';

// Dashboard labels for Caddy server IDs, per instance:
// { "<instanceId>": { "srv0": "HTTPS Sites" } }. Two instances can both have
// an srv0, so labels can't be keyed by server ID alone.
const NAMES_PATH = process.env.SERVER_NAMES_PATH || '/etc/caddy-ui/server-names.json';

const store = createJsonStore(NAMES_PATH, { parse: () => ({}) });

function isLabelMap(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && Object.values(value).every(v => typeof v === 'string');
}

// Older versions stored one flat { serverId: label } map shared by every
// instance. Copying it to each instance keeps every label where it was shown
// before, after which instances can diverge. Returns null for unusable input,
// and for a legacy file when there are no instances yet to copy it to, so
// it's left on disk untouched.
export function migrateServerNames(raw, instanceIds) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    const entries = Object.entries(raw);
    if (!entries.length) {
        return {};
    }
    if (entries.every(([, v]) => typeof v === 'string')) {
        if (!instanceIds.length) {
            return null;
        }
        return Object.fromEntries(instanceIds.map(id => [id, { ...raw }]));
    }
    return Object.fromEntries(entries.filter(([, v]) => isLabelMap(v)));
}

export async function loadServerNames(instanceIds) {
    const raw = await readJsonState(NAMES_PATH);
    const migrated = migrateServerNames(raw, instanceIds);
    if (migrated && JSON.stringify(migrated) !== JSON.stringify(raw)) {
        await store.set(migrated);
        logger.info('Server names migrated to per-instance labels', { instances: instanceIds.length });
        return;
    }
    store.hydrate(migrated || {});
}

export function getServerNames(instanceId) {
    return { ...(store.get()[instanceId] || {}) };
}

export function getAllServerNames() {
    return structuredClone(store.get());
}

export async function setServerName(instanceId, serverId, name) {
    await store.update(names => {
        names[instanceId] = { ...(names[instanceId] || {}), [serverId]: name };
    });
}

export async function removeServerName(instanceId, serverId) {
    await store.update(names => {
        if (!names[instanceId]) {
            return false;
        }
        delete names[instanceId][serverId];
        if (!Object.keys(names[instanceId]).length) {
            delete names[instanceId];
        }
    });
}

export async function removeInstanceServerNames(instanceId) {
    await store.update(names => {
        if (!names[instanceId]) {
            return false;
        }
        delete names[instanceId];
    });
}

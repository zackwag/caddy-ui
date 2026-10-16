import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import logger from './logger.js';

// Dashboard labels for Caddy server IDs, per instance:
// { "<instanceId>": { "srv0": "HTTPS Sites" } }. Two instances can both have
// an srv0, so labels can't be keyed by server ID alone.
const NAMES_PATH = process.env.SERVER_NAMES_PATH || '/etc/caddy-ui/server-names.json';

let _state = {};
let _writeLock = Promise.resolve();

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
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const entries = Object.entries(raw);
    if (!entries.length) return {};
    if (entries.every(([, v]) => typeof v === 'string')) {
        if (!instanceIds.length) return null;
        return Object.fromEntries(instanceIds.map(id => [id, { ...raw }]));
    }
    return Object.fromEntries(entries.filter(([, v]) => isLabelMap(v)));
}

export async function loadServerNames(instanceIds) {
    let raw = null;
    try {
        raw = JSON.parse(await readFile(NAMES_PATH, 'utf8'));
    } catch { }
    const migrated = migrateServerNames(raw, instanceIds);
    _state = migrated || {};
    if (migrated && JSON.stringify(migrated) !== JSON.stringify(raw)) {
        await _flush();
        logger.info('Server names migrated to per-instance labels', { instances: instanceIds.length });
    }
}

export function getServerNames(instanceId) {
    return { ...(_state[instanceId] || {}) };
}

export function getAllServerNames() {
    return structuredClone(_state);
}

export async function setServerName(instanceId, serverId, name) {
    _state[instanceId] = { ...(_state[instanceId] || {}), [serverId]: name };
    await _flush();
}

export async function removeServerName(instanceId, serverId) {
    if (!_state[instanceId]) return;
    delete _state[instanceId][serverId];
    if (!Object.keys(_state[instanceId]).length) delete _state[instanceId];
    await _flush();
}

export async function removeInstanceServerNames(instanceId) {
    if (!_state[instanceId]) return;
    delete _state[instanceId];
    await _flush();
}

async function _flush() {
    _writeLock = _writeLock.then(async () => {
        await mkdir(dirname(NAMES_PATH), { recursive: true });
        await writeFile(NAMES_PATH, JSON.stringify(_state, null, 2), 'utf8');
    });
    await _writeLock;
}

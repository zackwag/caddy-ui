import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { AppError } from './AppError.js';
import logger from './logger.js';

const INSTANCES_PATH = process.env.INSTANCES_PATH || '/etc/caddy-ui/instances.json';

// The bootstrap instance's id when no instances.json exists yet. Requests that
// omit X-Instance-Id, or send this id, select it or else the first instance.
export const DEFAULT_INSTANCE_ID = 'default';

let _instances = null;
let _writeLock = Promise.resolve();

// Instances saved before validateUrl dropped the trailing slash still have
// one, and the background monitors use adminUrl without re-validating it.
export function normalizeAdminUrl(url) {
    return typeof url === 'string' ? url.replace(/\/+$/, '') : url;
}

function buildDefaultInstance() {
    if (!process.env.CADDY_ADMIN_URL) return null;
    return {
        id: DEFAULT_INSTANCE_ID,
        name: 'Default',
        adminUrl: normalizeAdminUrl(process.env.CADDY_ADMIN_URL),
        configPath: process.env.CADDY_CONFIG_PATH || '/etc/caddy/Caddyfile',
        logPath: process.env.CADDY_LOG_PATH || '/var/log/caddy/access.log',
        dataPath: process.env.CADDY_DATA_PATH || '/data/caddy',
        containerName: process.env.CADDY_CONTAINER_NAME || 'caddy',
        serverName: process.env.CADDY_SERVER_NAME || 'srv0',
    };
}

export async function loadInstances() {
    try {
        const raw = await readFile(INSTANCES_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            _instances = parsed.map(inst => (inst && typeof inst === 'object' ? { ...inst, adminUrl: normalizeAdminUrl(inst.adminUrl) } : inst));
            return _instances;
        }
    } catch { }
    const defaultInst = buildDefaultInstance();
    _instances = defaultInst ? [defaultInst] : [];
    return _instances;
}

// Derive a change inside the write queue against the last successfully saved
// state. Publish the new array only after persistence succeeds.
export async function saveInstances(change) {
    // A failed operation still rejects its caller, but must not prevent later
    // operations from retrying against the last successfully saved state.
    _writeLock = _writeLock.catch(() => {}).then(async () => {
        const instances = typeof change === 'function' ? change(getInstances()) : change;
        await mkdir(dirname(INSTANCES_PATH), { recursive: true });
        await writeFile(INSTANCES_PATH, JSON.stringify(instances, null, 2), 'utf8');
        _instances = instances;
        return instances;
    });
    return _writeLock;
}

export function getInstances() {
    return _instances || [];
}

// Only an omitted or default selection falls back to the first instance. Any
// other unknown id returns null, so a stale selection can't reach another instance.
export function getInstance(id) {
    const instances = getInstances();
    const selected = id || DEFAULT_INSTANCE_ID;
    const match = instances.find(i => i.id === selected);
    if (match) return match;
    return selected === DEFAULT_INSTANCE_ID ? instances[0] || null : null;
}

export async function addInstance(instance) {
    await saveInstances(instances => {
        if (instances.find(i => i.id === instance.id)) {
            throw new AppError('CONFLICT', { message: `Instance "${instance.id}" already exists` });
        }
        return [...instances, instance];
    });
    logger.info('Instance added', { id: instance.id, name: instance.name });
    return instance;
}

export async function updateInstance(id, updates) {
    const saved = await saveInstances(instances => {
        const idx = instances.findIndex(i => i.id === id);
        if (idx === -1) throw new AppError('INSTANCE_NOT_FOUND', { message: `Instance "${id}" not found` });
        return instances.map((inst, i) => i === idx ? { ...inst, ...updates, id } : inst);
    });
    logger.info('Instance updated', { id });
    return saved.find(instance => instance.id === id);
}

export async function removeInstance(id) {
    await saveInstances(instances => {
        const idx = instances.findIndex(i => i.id === id);
        if (idx === -1) throw new AppError('INSTANCE_NOT_FOUND', { message: `Instance "${id}" not found` });
        return instances.filter((_, i) => i !== idx);
    });
    logger.info('Instance removed', { id });
}

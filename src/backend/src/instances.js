import { AppError } from './AppError.js';
import { createJsonStore } from './jsonFile.js';
import logger from './logger.js';

const INSTANCES_PATH = process.env.INSTANCES_PATH || '/etc/caddy-ui/instances.json';

// The bootstrap instance's id when no instances.json exists yet. Requests that
// omit X-Instance-Id, or send this id, select it or else the first instance.
export const DEFAULT_INSTANCE_ID = 'default';

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

function parseInstances(parsed) {
    if (Array.isArray(parsed)) {
        return parsed.map(inst => (inst && typeof inst === 'object' ? { ...inst, adminUrl: normalizeAdminUrl(inst.adminUrl) } : inst));
    }
    const defaultInst = buildDefaultInstance();
    return defaultInst ? [defaultInst] : [];
}

const store = createJsonStore(INSTANCES_PATH, { parse: parseInstances });

export function loadInstances() {
    return store.load();
}

export function getInstances() {
    return store.get();
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
    await store.update(instances => {
        if (instances.find(i => i.id === instance.id)) {
            throw new AppError('CONFLICT', { message: `Instance "${instance.id}" already exists` });
        }
        return [...instances, instance];
    });
    logger.info('Instance added', { id: instance.id, name: instance.name });
    return instance;
}

export async function updateInstance(id, updates) {
    const saved = await store.update(instances => {
        const idx = instances.findIndex(i => i.id === id);
        if (idx === -1) throw new AppError('INSTANCE_NOT_FOUND', { message: `Instance "${id}" not found` });
        return instances.map((inst, i) => i === idx ? { ...inst, ...updates, id } : inst);
    });
    logger.info('Instance updated', { id });
    return saved.find(instance => instance.id === id);
}

const removalListeners = new Set();

// State kept per instance elsewhere is released through these, so a new
// instance that reuses the id starts clean.
export function onInstanceRemoved(listener) {
    removalListeners.add(listener);
}

export async function removeInstance(id) {
    await store.update(instances => {
        const idx = instances.findIndex(i => i.id === id);
        if (idx === -1) throw new AppError('INSTANCE_NOT_FOUND', { message: `Instance "${id}" not found` });
        return instances.filter((_, i) => i !== idx);
    });
    logger.info('Instance removed', { id });
    // The instance is gone either way, so a release that fails is logged
    // rather than reported as a failed removal.
    for (const listener of removalListeners) {
        try {
            await listener(id);
        } catch (err) {
            logger.error('Could not release state for removed instance', { id, error: err.message });
        }
    }
}

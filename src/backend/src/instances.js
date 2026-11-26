import { AppError } from './AppError.js';
import { CorruptJsonError, createJsonStore } from './jsonFile.js';
import logger from './logger.js';
import { sanitizeName, validatePath, validateUrl } from './validation.js';

const INSTANCES_PATH = process.env.INSTANCES_PATH || '/etc/caddy-ui/instances.json';

// The bootstrap instance's id when no instances.json exists yet. Requests that
// omit X-Instance-Id, or send this id, select it or else the first instance.
export const DEFAULT_INSTANCE_ID = 'default';

// Where a stock Caddy container keeps things, for whatever an instance doesn't say.
export const INSTANCE_DEFAULTS = Object.freeze({
    configPath: '/etc/caddy/Caddyfile',
    logPath: '/var/log/caddy/access.log',
    dataPath: '/data/caddy',
    containerName: 'caddy',
    serverName: 'srv0',
});

const invalidField = (field, cause) => new AppError('VALIDATION_FAILED', { cause, context: { field } });

// A container or server name. `strict` rejects characters one can't contain;
// otherwise they're removed, which migrates a hand-edited file.
function checkedName(value, field, strict) {
    const name = sanitizeName(value);
    if (strict && name !== String(value)) {
        throw invalidField(field);
    }
    return name;
}

// The only form of an instance the rest of the backend sees: every field
// present, paths resolved and the admin URL normalized, so requests and
// background work key per-instance state the same way. An omitted container
// name is local mode. Throws VALIDATION_FAILED naming the field that can't be
// made safe.
function normalizeInstance(instance, { strict = false } = {}) {
    if (!instance || typeof instance !== 'object' || Array.isArray(instance)) {
        throw invalidField('id');
    }
    const checked = (field, validate) => {
        try {
            return validate(instance[field]);
        } catch (cause) {
            throw invalidField(field, cause);
        }
    };
    if (typeof instance.id !== 'string' || !instance.id) {
        throw invalidField('id');
    }
    return {
        id: instance.id,
        name: typeof instance.name === 'string' && instance.name ? instance.name : instance.id,
        adminUrl: checked('adminUrl', validateUrl),
        configPath: checked('configPath', value => validatePath(value ?? INSTANCE_DEFAULTS.configPath)),
        logPath: checked('logPath', value => validatePath(value ?? INSTANCE_DEFAULTS.logPath)),
        dataPath: checked('dataPath', value => validatePath(value ?? INSTANCE_DEFAULTS.dataPath)),
        containerName: checkedName(instance.containerName ?? '', 'containerName', strict),
        serverName: checkedName(instance.serverName || INSTANCE_DEFAULTS.serverName, 'serverName', strict),
    };
}

function buildDefaultInstance() {
    if (!process.env.CADDY_ADMIN_URL) return null;
    try {
        return normalizeInstance({
            id: DEFAULT_INSTANCE_ID,
            name: 'Default',
            adminUrl: process.env.CADDY_ADMIN_URL,
            configPath: process.env.CADDY_CONFIG_PATH,
            logPath: process.env.CADDY_LOG_PATH,
            dataPath: process.env.CADDY_DATA_PATH,
            containerName: process.env.CADDY_CONTAINER_NAME || INSTANCE_DEFAULTS.containerName,
            serverName: process.env.CADDY_SERVER_NAME,
        });
    } catch (err) {
        logger.error('The CADDY_* environment variables describe an invalid instance, so no default instance is configured', { field: err.context?.field, error: err.cause?.message });
        return null;
    }
}

// A file with a value that can't be made safe is set aside like an unparseable one.
function parseInstances(parsed) {
    if (Array.isArray(parsed)) {
        try {
            return parsed.map(instance => normalizeInstance(instance));
        } catch (err) {
            throw new CorruptJsonError(INSTANCES_PATH, new Error(`${err.context.field}: ${err.cause?.message || 'invalid'}`));
        }
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

// An id for a new instance, from its name, that no instance has yet.
export function generateId(name, existingIds = new Set(getInstances().map(instance => instance.id))) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'instance';
    if (!existingIds.has(base)) return base;
    let suffix = 2;
    while (existingIds.has(`${base}-${suffix}`)) suffix++;
    return `${base}-${suffix}`;
}

// Server IDs from Caddy's /config/apps/http/servers response, which is null
// when no http app is configured.
export function serverIdsFromConfig(servers) {
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
    return Object.keys(servers).sort();
}

const savedListeners = new Set();
const removalListeners = new Set();

// The instance is saved either way, so a listener that fails is logged rather
// than reported as a failed change.
async function notify(listeners, id, failure) {
    for (const listener of listeners) {
        try {
            await listener(id);
        } catch (err) {
            logger.error(failure, { id, error: err.message });
        }
    }
}

// Called after an instance is added or updated, e.g. to assign saved state
// whose owner can now be proven.
export function onInstanceSaved(listener) {
    savedListeners.add(listener);
}

// State kept per instance elsewhere is released through these, so a new
// instance that reuses the id starts clean.
export function onInstanceRemoved(listener) {
    removalListeners.add(listener);
}

export async function addInstance(fields) {
    const instance = normalizeInstance(fields, { strict: true });
    await store.update(instances => {
        if (instances.find(i => i.id === instance.id)) {
            throw new AppError('CONFLICT', { message: `Instance "${instance.id}" already exists` });
        }
        return [...instances, instance];
    });
    logger.info('Instance added', { id: instance.id, name: instance.name });
    await notify(savedListeners, instance.id, 'Could not update state for saved instance');
    return instance;
}

export async function updateInstance(id, updates) {
    const saved = await store.update(instances => {
        const idx = instances.findIndex(i => i.id === id);
        if (idx === -1) throw new AppError('INSTANCE_NOT_FOUND', { message: `Instance "${id}" not found` });
        const updated = normalizeInstance({ ...instances[idx], ...updates, id }, { strict: true });
        return instances.map((inst, i) => i === idx ? updated : inst);
    });
    logger.info('Instance updated', { id });
    await notify(savedListeners, id, 'Could not update state for saved instance');
    return saved.find(instance => instance.id === id);
}

export async function removeInstance(id) {
    await store.update(instances => {
        const idx = instances.findIndex(i => i.id === id);
        if (idx === -1) throw new AppError('INSTANCE_NOT_FOUND', { message: `Instance "${id}" not found` });
        return instances.filter((_, i) => i !== idx);
    });
    logger.info('Instance removed', { id });
    await notify(removalListeners, id, 'Could not release state for removed instance');
}

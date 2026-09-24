import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import logger from './logger.js';

const INSTANCES_PATH = process.env.INSTANCES_PATH || '/etc/caddy-ui/instances.json';

let _instances = null;
let _writeLock = Promise.resolve();

function buildDefaultInstance() {
    if (!process.env.CADDY_ADMIN_URL) return null;
    return {
        id: 'default',
        name: 'Default',
        adminUrl: process.env.CADDY_ADMIN_URL,
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
            _instances = parsed;
            return _instances;
        }
    } catch { }
    const defaultInst = buildDefaultInstance();
    _instances = defaultInst ? [defaultInst] : [];
    return _instances;
}

export async function saveInstances(instances) {
    _writeLock = _writeLock.then(async () => {
        await mkdir(dirname(INSTANCES_PATH), { recursive: true });
        await writeFile(INSTANCES_PATH, JSON.stringify(instances, null, 2), 'utf8');
        _instances = instances;
    });
    return _writeLock;
}

export function getInstances() {
    return _instances || [];
}

export function getInstance(id) {
    const instances = getInstances();
    return instances.find(i => i.id === id) || instances[0];
}

export async function addInstance(instance) {
    const instances = getInstances();
    if (instances.find(i => i.id === instance.id)) {
        throw new Error(`Instance "${instance.id}" already exists`);
    }
    instances.push(instance);
    await saveInstances(instances);
    logger.info('Instance added', { id: instance.id, name: instance.name });
    return instance;
}

export async function updateInstance(id, updates) {
    const instances = getInstances();
    const idx = instances.findIndex(i => i.id === id);
    if (idx === -1) throw new Error(`Instance "${id}" not found`);
    instances[idx] = { ...instances[idx], ...updates, id };
    await saveInstances(instances);
    logger.info('Instance updated', { id });
    return instances[idx];
}

export async function removeInstance(id) {
    const instances = getInstances();
    const idx = instances.findIndex(i => i.id === id);
    if (idx === -1) throw new Error(`Instance "${id}" not found`);
    instances.splice(idx, 1);
    await saveInstances(instances);
    logger.info('Instance removed', { id });
}

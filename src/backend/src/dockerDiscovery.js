import { request } from 'http';
import { INSTANCE_DEFAULTS } from './instances.js';
import logger from './logger.js';

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

function dockerGet(path) {
    return new Promise((resolve, reject) => {
        const req = request({ socketPath: DOCKER_SOCKET, path, method: 'GET' }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    reject(new Error(`Docker API ${res.statusCode}: ${data}`));
                    return;
                }
                try { resolve(JSON.parse(data)); }
                catch { reject(new Error('Invalid JSON from Docker API')); }
            });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('Docker API timeout')); });
        req.end();
    });
}

// Caddy's admin API always binds to 2019 unless the Caddyfile's global
// `admin` directive overrides it, which isn't visible from container metadata.
const ADMIN_PORT = 2019;

function extractEnvVar(container, name) {
    const env = container.Config?.Env || [];
    for (const entry of env) {
        const eq = entry.indexOf('=');
        if (eq > 0 && entry.slice(0, eq) === name) {
            return entry.slice(eq + 1);
        }
    }
    return null;
}

function findContainerIP(container, targetNetworks) {
    const networks = container.NetworkSettings?.Networks || {};
    for (const name of targetNetworks) {
        if (networks[name]?.IPAddress) {
            return networks[name].IPAddress;
        }
    }
    for (const net of Object.values(networks)) {
        if (net.IPAddress) {
            return net.IPAddress;
        }
    }
    return null;
}

// The port the backend listens on, which Caddy proxies maintenance pages to.
export const BACKEND_PORT = process.env.PORT || 3001;

let backendContainerName = null;
let detectionFailureLogged = false;

// The backend's own container name, from Docker: the container whose id is
// this hostname, or else one named caddy-ui-backend, for a compose file that
// sets `hostname:`. Kept once found; a failed lookup is tried again next time
// and its reason logged once.
async function detectBackendContainerName() {
    if (backendContainerName) {
        return backendContainerName;
    }
    let failure;
    for (const id of [process.env.HOSTNAME, 'caddy-ui-backend'].filter(Boolean)) {
        try {
            const name = (await dockerGet(`/containers/${encodeURIComponent(id)}/json`)).Name?.replace(/^\//, '');
            if (name) {
                backendContainerName = name;
                logger.info('Detected backend container name', { name });
                return name;
            }
        } catch (err) {
            failure = err;
        }
    }
    if (failure && !detectionFailureLogged) {
        detectionFailureLogged = true;
        logger.warn('Could not detect the backend container name; set CADDY_UI_URL for maintenance pages', { error: failure.message });
    }
    return null;
}

// Where Caddy reaches the backend, or null when it can't be known.
export async function getBackendUrl() {
    if (process.env.CADDY_UI_URL) {
        return process.env.CADDY_UI_URL;
    }
    const name = await detectBackendContainerName();
    return name ? `${name}:${BACKEND_PORT}` : null;
}

// Connecting to a socket that doesn't exist, or that nothing listens on
const NO_DOCKER = new Set(['ENOENT', 'ECONNREFUSED']);

export async function discoverCaddyContainers() {
    let containers;
    try {
        containers = await dockerGet('/containers/json?all=false');
    } catch (err) {
        // No Docker socket at all, as in a local-mode install: nothing to discover
        if (NO_DOCKER.has(err.code)) {
            return [];
        }
        throw err;
    }

    const backendNetworks = new Set();
    const hostname = process.env.HOSTNAME;
    if (hostname) {
        for (const c of containers) {
            const names = (c.Names || []).map(n => n.replace(/^\//, ''));
            if (names.includes('caddy-ui-backend') || c.Id?.startsWith(hostname)) {
                const nets = c.NetworkSettings?.Networks || {};
                for (const name of Object.keys(nets)) {
                    backendNetworks.add(name);
                }
            }
        }
    }

    const candidates = containers.filter(c => {
        const image = c.Image || '';
        return /caddy/i.test(image) && !/caddy-ui/i.test(image);
    });

    const results = await Promise.all(candidates.map(async c => {
        const name = (c.Names || [])[0]?.replace(/^\//, '') || c.Id?.slice(0, 12);

        let detail;
        try {
            detail = await dockerGet(`/containers/${c.Id}/json`);
        } catch {
            return null;
        }

        const ip = findContainerIP(detail, [...backendNetworks]);
        const adminUrl = `http://${ip || name}:${ADMIN_PORT}`;

        return {
            containerId: c.Id?.slice(0, 12),
            containerName: name,
            image: c.Image || '',
            adminUrl,
            configPath: extractEnvVar(detail, 'CADDY_CONFIG_PATH') || INSTANCE_DEFAULTS.configPath,
            logPath: extractEnvVar(detail, 'CADDY_LOG_PATH') || INSTANCE_DEFAULTS.logPath,
            dataPath: INSTANCE_DEFAULTS.dataPath,
            serverName: extractEnvVar(detail, 'CADDY_SERVER_NAME') || INSTANCE_DEFAULTS.serverName,
        };
    }));

    return results.filter(Boolean);
}

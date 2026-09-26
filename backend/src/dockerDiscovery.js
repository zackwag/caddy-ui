import { request } from 'http';
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

function extractAdminPort(container) {
    const config = container.Config || {};
    const ports = config.ExposedPorts || {};
    if ('2019/tcp' in ports) return 2019;
    for (const key of Object.keys(ports)) {
        const p = parseInt(key);
        if (p === 2019) return p;
    }
    return 2019;
}

function extractEnvVar(container, name) {
    const env = container.Config?.Env || [];
    for (const entry of env) {
        const eq = entry.indexOf('=');
        if (eq > 0 && entry.slice(0, eq) === name) return entry.slice(eq + 1);
    }
    return null;
}

function findContainerIP(container, targetNetworks) {
    const networks = container.NetworkSettings?.Networks || {};
    for (const name of targetNetworks) {
        if (networks[name]?.IPAddress) return networks[name].IPAddress;
    }
    for (const net of Object.values(networks)) {
        if (net.IPAddress) return net.IPAddress;
    }
    return null;
}

export async function discoverCaddyContainers() {
    let containers;
    try {
        containers = await dockerGet('/containers/json?all=false');
    } catch (err) {
        logger.warn('Docker discovery unavailable', { error: err.message });
        return [];
    }

    const backendNetworks = new Set();
    const hostname = process.env.HOSTNAME;
    if (hostname) {
        for (const c of containers) {
            const names = (c.Names || []).map(n => n.replace(/^\//, ''));
            if (names.includes('caddy-ui-backend') || c.Id?.startsWith(hostname)) {
                const nets = c.NetworkSettings?.Networks || {};
                for (const name of Object.keys(nets)) backendNetworks.add(name);
            }
        }
    }

    const results = [];
    for (const c of containers) {
        const image = c.Image || '';
        if (!/caddy/i.test(image) || /caddy-ui/i.test(image)) continue;

        const name = (c.Names || [])[0]?.replace(/^\//, '') || c.Id?.slice(0, 12);

        let detail;
        try {
            detail = await dockerGet(`/containers/${c.Id}/json`);
        } catch {
            continue;
        }

        const ip = findContainerIP(detail, [...backendNetworks]);
        const port = extractAdminPort(detail);
        const adminUrl = ip ? `http://${ip}:${port}` : `http://${name}:${port}`;

        results.push({
            containerId: c.Id?.slice(0, 12),
            containerName: name,
            image,
            adminUrl,
            configPath: extractEnvVar(detail, 'CADDY_CONFIG_PATH') || '/etc/caddy/Caddyfile',
            logPath: extractEnvVar(detail, 'CADDY_LOG_PATH') || '/var/log/caddy/access.log',
            dataPath: '/data/caddy',
            serverName: extractEnvVar(detail, 'CADDY_SERVER_NAME') || 'srv0',
        });
    }

    return results;
}

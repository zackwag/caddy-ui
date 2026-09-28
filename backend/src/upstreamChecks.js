import { createConnection } from 'net';
import { caddyGet } from './caddy.js';

const TCP_TIMEOUT_MS = 3000;

export function extractUpstreams(route) {
    const results = [];
    function walk(handles) {
        for (const h of handles || []) {
            if (h.handler === 'reverse_proxy' && h.upstreams) {
                for (const u of h.upstreams) if (u.dial) results.push(u.dial);
            }
            if (h.routes) for (const r of h.routes) walk(r.handle);
        }
    }
    walk(route.handle);
    return results;
}

export function getHost(route) {
    return route.match?.find(m => m.host)?.host?.[0] || null;
}

function checkTCP(host, port) {
    return new Promise((resolve) => {
        const socket = createConnection({ host, port: parseInt(port), timeout: TCP_TIMEOUT_MS });
        const timer = setTimeout(() => { socket.destroy(); resolve(false); }, TCP_TIMEOUT_MS);
        socket.on('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
        socket.on('error', () => { clearTimeout(timer); resolve(false); });
        socket.on('timeout', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
    });
}

// Determines online/offline for every reverse_proxy upstream in an instance's
// Caddy config, preferring Caddy's own upstream health-tracking pool and
// falling back to a raw TCP dial for upstreams it hasn't polled yet. Throws
// on failure to reach the instance's admin API -- callers decide how to
// handle that (fail a request vs. skip an instance for one monitor tick).
export async function checkInstanceUpstreams(adminUrl) {
    const servers = await caddyGet('/config/apps/http/servers', adminUrl);

    const checks = [];
    for (const [serverName, server] of Object.entries(servers || {})) {
        for (const route of server.routes || []) {
            const domain = getHost(route);
            for (const upstream of extractUpstreams(route)) {
                const [host, port] = upstream.split(':');
                if (host && port) checks.push({ domain, upstream, host, port, server: serverName });
            }
        }
    }

    let caddyPool = {};
    try {
        const poolRes = await fetch(`${adminUrl}/reverse_proxy/upstreams`, {
            headers: { 'Origin': 'http://0.0.0.0:2019' },
            signal: AbortSignal.timeout(3000),
        });
        if (poolRes.ok) {
            const pool = await poolRes.json();
            for (const entry of pool) {
                if (entry.address) caddyPool[entry.address] = entry;
            }
        }
    } catch { }

    return Promise.all(checks.map(async (check) => ({
        ...check,
        online: check.upstream in caddyPool ? caddyPool[check.upstream].fails === 0 : await checkTCP(check.host, check.port),
    })));
}

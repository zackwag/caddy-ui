import { createConnection } from 'net';
import { caddyGet } from './caddy.js';

const TCP_TIMEOUT_MS = 3000;

// Caddy only counts failures (`fails` in /reverse_proxy/upstreams) when the
// handler has passive health checks with a non-zero fail_duration. Without
// that the count stays 0 forever, so the pool can't vouch for an upstream.
function passivePolicy(handler) {
    const passive = handler.health_checks?.passive;
    if (!passive?.fail_duration || /^0[a-zµ]*$/i.test(String(passive.fail_duration))) return null;
    return { maxFails: passive.max_fails || 1 };
}

export function extractUpstreamTargets(route) {
    const results = [];
    function walk(handles) {
        for (const h of handles || []) {
            if (h.handler === 'reverse_proxy' && h.upstreams) {
                const passive = passivePolicy(h);
                for (const u of h.upstreams) if (u.dial) results.push({ dial: u.dial, passive });
            }
            if (h.routes) for (const r of h.routes) walk(r.handle);
        }
    }
    walk(route.handle);
    return results;
}

export function extractUpstreams(route) {
    return extractUpstreamTargets(route).map(t => t.dial);
}

// An upstream is online when caddy-ui can dial it and, if passive health
// checks are on, Caddy hasn't marked it down after failed requests.
export function isUpstreamOnline(dialed, passive, poolEntry) {
    if (!dialed) return false;
    return !(passive && poolEntry && poolEntry.fails >= passive.maxFails);
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
// Caddy config with a TCP dial, also consulting Caddy's upstream pool for
// handlers with passive health checks (see isUpstreamOnline). Throws on
// failure to reach the instance's admin API -- callers decide how to handle
// that (fail a request vs. skip an instance for one monitor tick).
export async function checkInstanceUpstreams(adminUrl) {
    const servers = await caddyGet('/config/apps/http/servers', adminUrl);

    const checks = [];
    for (const [serverName, server] of Object.entries(servers || {})) {
        for (const route of server.routes || []) {
            const domain = getHost(route);
            for (const { dial: upstream, passive } of extractUpstreamTargets(route)) {
                const [host, port] = upstream.split(':');
                if (host && port) checks.push({ domain, upstream, host, port, server: serverName, passive });
            }
        }
    }

    const caddyPool = {};
    if (checks.some(c => c.passive)) {
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
    }

    // Upstreams shared by several routes are dialed once per call
    const dials = new Map();
    const dial = (upstream, host, port) => {
        if (!dials.has(upstream)) dials.set(upstream, checkTCP(host, port));
        return dials.get(upstream);
    };

    return Promise.all(checks.map(async ({ passive, ...check }) => ({
        ...check,
        online: isUpstreamOnline(await dial(check.upstream, check.host, check.port), passive, caddyPool[check.upstream]),
    })));
}

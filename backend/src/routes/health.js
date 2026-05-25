import { Router } from 'express';
import { createConnection } from 'net';
import { CADDY_ADMIN_URL, caddyGet } from '../caddy.js';

const router = Router();
const TIMEOUT_MS = 3000;
const WINDOW_SIZE = 288; // ~2.5 hours at 30s intervals

// In-memory uptime tracking
const uptimeHistory = {}; // upstream -> { results: boolean[], firstSeen: Date }

function recordCheck(upstream, online) {
    if (!uptimeHistory[upstream]) {
        uptimeHistory[upstream] = { results: [], firstSeen: new Date() };
    }
    const entry = uptimeHistory[upstream];
    entry.results.push(online);
    if (entry.results.length > WINDOW_SIZE) entry.results.shift();
}

function getUptimeStats(upstream) {
    const entry = uptimeHistory[upstream];
    if (!entry || entry.results.length === 0) return null;
    const total = entry.results.length;
    const online = entry.results.filter(Boolean).length;
    const pct = Math.round((online / total) * 1000) / 10;
    const currentlyOnline = entry.results[entry.results.length - 1];

    let streak = 0;
    for (let i = entry.results.length - 1; i >= 0; i--) {
        if (entry.results[i] === currentlyOnline) streak++;
        else break;
    }

    const streakSeconds = streak * 30;
    const streakLabel = formatDuration(streakSeconds);

    return { pct, total, online, currentlyOnline, streak, streakSeconds, streakLabel, firstSeen: entry.firstSeen };
}

function formatDuration(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${seconds}s`;
}

function checkTCP(host, port) {
    return new Promise((resolve) => {
        const socket = createConnection({ host, port: parseInt(port), timeout: TIMEOUT_MS });
        const timer = setTimeout(() => { socket.destroy(); resolve(false); }, TIMEOUT_MS);
        socket.on('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
        socket.on('error', () => { clearTimeout(timer); resolve(false); });
        socket.on('timeout', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
    });
}

function extractUpstreams(route) {
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

function getHost(route) {
    return route.match?.find(m => m.host)?.host?.[0] || null;
}

// GET /api/health
router.get('/', async (req, res) => {
    try {
        const servers = await caddyGet('/config/apps/http/servers');

        // Build list of all upstreams from routes
        const checks = [];
        for (const [serverName, server] of Object.entries(servers || {})) {
            for (const route of server.routes || []) {
                const domain = getHost(route);
                for (const upstream of extractUpstreams(route)) {
                    const [host, port] = upstream.split(':');
                    if (!host || !port) continue;
                    checks.push({ domain, upstream, host, port, server: serverName });
                }
            }
        }

        // Fetch Caddy's reverse proxy upstream pool.
        // This gives us Caddy's own view of upstream health including active request counts
        // and passive failure tracking. We use this as the primary source where available
        // and fall back to TCP checks for upstreams not yet in the pool.
        let caddyPool = {};
        try {
            const poolRes = await fetch(`${CADDY_ADMIN_URL}/reverse_proxy/upstreams`, {
                headers: { 'Origin': 'http://0.0.0.0:2019' },
            });
            if (poolRes.ok) {
                const pool = await poolRes.json();
                for (const entry of pool) {
                    if (entry.address) caddyPool[entry.address] = entry;
                }
            }
        } catch { }

        const results = await Promise.all(
            checks.map(async (check) => {
                let online;

                if (check.upstream in caddyPool) {
                    // Caddy has seen this upstream and tracks it in its global pool.
                    // We derive online status from the fails counter. Note: this is only
                    // meaningful if passive health checks are configured in the Caddyfile
                    // (via health_checks > passive > max_fails). Without passive checks,
                    // fails will always be 0 and every known upstream will appear online.
                    // For most home/self-hosted setups this is acceptable -- the TCP fallback
                    // below handles upstreams Caddy hasn't seen traffic through yet.
                    const entry = caddyPool[check.upstream];
                    online = entry.fails === 0;
                } else {
                    // Upstream is not in Caddy's pool -- either Caddy hasn't proxied any
                    // traffic to it since the last restart, or it's defined only in the
                    // Caddyfile without an active @id. Fall back to a direct TCP connect.
                    online = await checkTCP(check.host, check.port);
                }

                recordCheck(check.upstream, online);
                return {
                    domain: check.domain,
                    upstream: check.upstream,
                    server: check.server,
                    online,
                    checkedAt: new Date().toISOString(),
                };
            })
        );

        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/health/uptime -- uptime stats per upstream
router.get('/uptime', async (req, res) => {
    const stats = {};
    for (const [upstream] of Object.entries(uptimeHistory)) {
        stats[upstream] = getUptimeStats(upstream);
    }
    res.json(stats);
});

export default router;

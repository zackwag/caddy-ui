import { Router } from 'express';
import { createConnection } from 'net';
import { caddyGet } from '../caddy.js';

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
    if (entry.results.length > WINDOW_SIZE) {
        entry.results.shift();
    }
}

function getUptimeStats(upstream) {
    const entry = uptimeHistory[upstream];
    if (!entry || entry.results.length === 0) return null;
    const total = entry.results.length;
    const online = entry.results.filter(Boolean).length;
    const pct = Math.round((online / total) * 1000) / 10;
    const currentlyOnline = entry.results[entry.results.length - 1];

    // Calculate current streak
    let streak = 0;
    for (let i = entry.results.length - 1; i >= 0; i--) {
        if (entry.results[i] === currentlyOnline) streak++;
        else break;
    }

    const streakSeconds = streak * 30;
    const streakLabel = formatDuration(streakSeconds);

    return {
        pct,
        total,
        online,
        currentlyOnline,
        streak,
        streakSeconds,
        streakLabel,
        firstSeen: entry.firstSeen,
    };
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
            if (h.routes) {
                for (const r of h.routes) walk(r.handle);
            }
        }
    }

    walk(route.handle);
    return results;
}

function getHost(route) {
    return route.match?.find(m => m.host)?.host?.[0] || null;
}

router.get('/', async (req, res) => {
    try {
        const servers = await caddyGet('/config/apps/http/servers');
        const checks = [];

        for (const [serverName, server] of Object.entries(servers || {})) {
            for (const route of server.routes || []) {
                const domain = getHost(route);
                const upstreams = extractUpstreams(route);
                for (const upstream of upstreams) {
                    const [host, port] = upstream.split(':');
                    if (!host || !port) continue;
                    checks.push({ domain, upstream, host, port, server: serverName });
                }
            }
        }

        const results = await Promise.all(
            checks.map(async (check) => {
                const online = await checkTCP(check.host, check.port);
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
    for (const [upstream, _] of Object.entries(uptimeHistory)) {
        stats[upstream] = getUptimeStats(upstream);
    }
    res.json(stats);
});

export default router;

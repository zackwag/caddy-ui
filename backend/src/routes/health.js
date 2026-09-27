import { Router } from 'express';
import { createConnection } from 'net';
import { caddyGet } from '../caddy.js';
import { getHistory, getStatsForInstance, recordCheck } from '../uptimeHistory.js';

const router = Router();
const TIMEOUT_MS = 3000;

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
    const { adminUrl, id: instanceId } = req.instance;
    try {
        const servers = await caddyGet('/config/apps/http/servers', adminUrl);

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

        let caddyPool = {};
        try {
            const poolRes = await fetch(`${adminUrl}/reverse_proxy/upstreams`, {
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
                    const entry = caddyPool[check.upstream];
                    online = entry.fails === 0;
                } else {
                    online = await checkTCP(check.host, check.port);
                }

                recordCheck(instanceId, check.upstream, online);
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
    res.json(getStatsForInstance(req.instance.id));
});

// GET /api/health/history?upstream=<upstream>&since=<epochMs> -- raw timestamped
// checks for the route status history modal
router.get('/history', async (req, res) => {
    const { upstream, since } = req.query;
    if (!upstream) return res.status(400).json({ error: 'upstream is required' });
    const sinceMs = since ? Number(since) : undefined;
    res.json(getHistory(req.instance.id, upstream, { sinceMs }));
});

export default router;
export { extractUpstreams, getHost };

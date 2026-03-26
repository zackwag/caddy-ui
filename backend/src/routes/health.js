import { Router } from 'express';
import { createConnection } from 'net';
import { caddyGet } from '../caddy.js';

const router = Router();
const TIMEOUT_MS = 3000;

function checkTCP(host, port) {
    return new Promise((resolve) => {
        const socket = createConnection({ host, port: parseInt(port), timeout: TIMEOUT_MS });
        const timer = setTimeout(() => {
            socket.destroy();
            resolve(false);
        }, TIMEOUT_MS);

        socket.on('connect', () => {
            clearTimeout(timer);
            socket.destroy();
            resolve(true);
        });

        socket.on('error', () => {
            clearTimeout(timer);
            resolve(false);
        });

        socket.on('timeout', () => {
            clearTimeout(timer);
            socket.destroy();
            resolve(false);
        });
    });
}

function extractUpstreams(route) {
    const results = [];
    const subroute = route.handle?.find(h => h.handler === 'subroute');
    const innerRoutes = subroute?.routes ?? [];
    for (const r of innerRoutes) {
        const rp = r.handle?.find(h => h.handler === 'reverse_proxy');
        if (rp?.upstreams) {
            for (const u of rp.upstreams) {
                if (u.dial) results.push(u.dial);
            }
        }
    }
    // Flat fallback
    const flat = route.handle?.find(h => h.handler === 'reverse_proxy');
    if (flat?.upstreams) {
        for (const u of flat.upstreams) {
            if (u.dial) results.push(u.dial);
        }
    }
    return results;
}

function getHost(route) {
    const hostMatcher = route.match?.find(m => m.host);
    return hostMatcher?.host?.[0] || null;
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

        // Run all checks in parallel
        const results = await Promise.all(
            checks.map(async (check) => {
                const online = await checkTCP(check.host, check.port);
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

export default router;

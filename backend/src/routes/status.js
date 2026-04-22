import { Router } from 'express';
import { CADDY_ADMIN_URL, caddyGet } from '../caddy.js';

const router = Router();

function parsePrometheusMetrics(text) {
    const result = {};
    for (const line of text.split('\n')) {
        if (line.startsWith('#') || !line.trim()) continue;
        const spaceIdx = line.lastIndexOf(' ');
        if (spaceIdx === -1) continue;
        const key = line.slice(0, spaceIdx).trim();
        const val = parseFloat(line.slice(spaceIdx + 1).trim());
        if (!isNaN(val)) result[key] = val;
    }
    return result;
}

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${seconds}s`;
}

// GET /api/status
router.get('/', async (req, res) => {
    try {
        const [config, metricsText] = await Promise.allSettled([
            caddyGet('/config/apps/http/servers'),
            fetch(`${CADDY_ADMIN_URL}/metrics`, { headers: { 'Origin': 'http://0.0.0.0:2019' } })
                .then(r => r.ok ? r.text() : null).catch(() => null),
        ]);

        const servers = Object.entries(config.value || {}).map(([name, server]) => ({
            name,
            listen: server.listen,
            routeCount: (server.routes || []).length,
        }));

        const routeCount = servers.reduce((sum, s) => sum + s.routeCount, 0);

        let uptime = null;
        if (metricsText.value) {
            const parsed = parsePrometheusMetrics(metricsText.value);
            const startTime = parsed['process_start_time_seconds'];
            if (startTime) uptime = formatUptime(Math.floor(Date.now() / 1000 - startTime));
        }

        let upstreamsOnline = null;
        let upstreamsTotal = null;
        try {
            const { createConnection } = await import('net');
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

            const checks = [];
            for (const [, server] of Object.entries(config.value || {})) {
                for (const route of server.routes || []) {
                    for (const upstream of extractUpstreams(route)) {
                        const [host, port] = upstream.split(':');
                        if (host && port) checks.push({ host, port });
                    }
                }
            }

            const results = await Promise.all(checks.map(c => checkTCP(c.host, c.port)));
            upstreamsTotal = results.length;
            upstreamsOnline = results.filter(Boolean).length;
        } catch { }

        res.json({
            online: true,
            serverCount: servers.length,
            routeCount,
            upstreamsOnline,
            upstreamsTotal,
            uptime,
            servers,
            tlsEnabled: true,
            adminUrl: CADDY_ADMIN_URL,
        });
    } catch (err) {
        res.json({ online: false, error: err.message });
    }
});

// GET /api/status/process
router.get('/process', async (req, res) => {
    try {
        const metricsRes = await fetch(`${CADDY_ADMIN_URL}/metrics`, {
            headers: { 'Origin': 'http://0.0.0.0:2019' },
        });
        if (!metricsRes.ok) throw new Error(`Metrics endpoint unavailable: ${metricsRes.status}`);
        const text = await metricsRes.text();
        const metrics = parsePrometheusMetrics(text);

        const startTime = metrics['process_start_time_seconds'];
        const uptimeSeconds = startTime ? Math.floor(Date.now() / 1000 - startTime) : null;
        const uptime = uptimeSeconds !== null ? formatUptime(uptimeSeconds) : null;
        const memAllocBytes = metrics['go_memstats_alloc_bytes'];
        const memSysBytes = metrics['go_memstats_sys_bytes'];
        const memAlloc = memAllocBytes ? Math.round(memAllocBytes / 1024 / 1024 * 10) / 10 : null;
        const memSys = memSysBytes ? Math.round(memSysBytes / 1024 / 1024 * 10) / 10 : null;
        const lastReloadTs = metrics['caddy_config_last_reload_success_timestamp_seconds'];
        const lastReload = lastReloadTs ? new Date(lastReloadTs * 1000).toISOString() : null;
        const lastReloadSuccess = metrics['caddy_config_last_reload_successful'] === 1;

        res.json({ ok: true, uptime, uptimeSeconds, memAlloc, memSys, lastReload, lastReloadSuccess });
    } catch (err) {
        res.json({ ok: false, error: err.message });
    }
});

export default router;

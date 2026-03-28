import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { caddyGet, caddyLoad } from '../caddy.js';

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
    return `${m}m`;
}

// GET /api/status
router.get('/', async (req, res) => {
    try {
        const config = await caddyGet('/config/apps/http/servers');
        const servers = Object.entries(config || {}).map(([name, server]) => ({
            name,
            listen: server.listen,
            routeCount: (server.routes || []).length,
        }));
        res.json({
            online: true,
            serverCount: servers.length,
            servers,
            tlsEnabled: true,
            adminUrl: process.env.CADDY_ADMIN_URL || 'http://caddy:2019',
        });
    } catch (err) {
        res.json({ online: false, error: err.message });
    }
});

// GET /api/status/process
router.get('/process', async (req, res) => {
    try {
        const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || 'http://caddy:2019';
        const metricsRes = await fetch(`${CADDY_ADMIN_URL}/metrics`, {
            headers: { 'Origin': 'http://0.0.0.0:2019' },
        });
        if (!metricsRes.ok) throw new Error(`Metrics endpoint unavailable: ${metricsRes.status}`);

        const text = await metricsRes.text();
        const metrics = parsePrometheusMetrics(text);

        const versionMatch = text.match(/go_build_info\{[^}]*version="([^"]+)"/);
        const version = versionMatch ? versionMatch[1] : 'unknown';

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

        res.json({ ok: true, version, uptime, uptimeSeconds, memAlloc, memSys, lastReload, lastReloadSuccess });
    } catch (err) {
        res.json({ ok: false, error: err.message });
    }
});

// GET /api/status/metrics-config
router.get('/metrics-config', async (req, res) => {
    try {
        const content = await readFile(process.env.CADDYFILE_PATH || '/etc/caddy/Caddyfile', 'utf8');
        const enabled = /^\s*metrics\s*$/m.test(content);
        res.json({ enabled });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/status/metrics-config
router.put('/metrics-config', async (req, res) => {
    const { enabled } = req.body;
    const CADDYFILE_PATH = process.env.CADDYFILE_PATH || '/etc/caddy/Caddyfile';
    try {
        let content = await readFile(CADDYFILE_PATH, 'utf8');
        if (enabled) {
            if (/^\s*metrics\s*$/m.test(content)) {
                return res.json({ ok: true, message: 'Metrics already enabled' });
            }
            content = content.replace(/^(\s*\{)/m, '$1\n    metrics');
        } else {
            content = content.replace(/^\s*metrics\s*\n?/m, '');
        }
        await writeFile(CADDYFILE_PATH, content, 'utf8');
        await caddyLoad(content);
        res.json({ ok: true, enabled });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/status/config
router.get('/config', async (req, res) => {
    try {
        const config = await caddyGet('/config/');
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;

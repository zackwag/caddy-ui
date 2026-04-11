import { Router } from 'express';
import http from 'http';
import { caddyGet } from '../caddy.js';

const router = Router();

function dockerRequest(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const opts = {
            socketPath: '/var/run/docker.sock',
            path,
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
        };
        const req = http.request(opts, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function getCaddyVersion() {
    try {
        const createRes = await dockerRequest('/containers/caddy/exec', 'POST', {
            AttachStdout: true,
            AttachStderr: true,
            Cmd: ['caddy', 'version'],
        });
        if (createRes.status !== 201) return 'unknown';
        const { Id } = JSON.parse(createRes.body.toString());

        const startRes = await dockerRequest(`/exec/${Id}/start`, 'POST', {
            Detach: false,
            Tty: false,
        });
        if (startRes.status !== 200) return 'unknown';

        const buf = startRes.body;
        let output = '';
        let offset = 0;
        while (offset < buf.length) {
            if (offset + 8 > buf.length) break;
            const size = buf.readUInt32BE(offset + 4);
            if (offset + 8 + size > buf.length) break;
            output += buf.slice(offset + 8, offset + 8 + size).toString();
            offset += 8 + size;
        }

        return output.trim().split(' ')[0] || 'unknown';
    } catch {
        return 'unknown';
    }
}

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

// GET /api/status/version
router.get('/version', async (req, res) => {
    const version = await getCaddyVersion();
    res.json({ version });
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

        const version = await getCaddyVersion();

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

// GET /api/status/caddy-config
router.get('/caddy-config', async (req, res) => {
    try {
        const config = await caddyGet('/config/');
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;

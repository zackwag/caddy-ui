import { Router } from 'express';
import { execInInstance } from '../docker.js';
import logger from '../logger.js';
import { asAppError } from '../AppError.js';
import { getServers, getUpstreamChecks } from '../observations.js';
import { resultsByUpstream } from '../upstreamChecks.js';

const router = Router();

async function getCaddyVersion(containerName) {
    try {
        const { stdout } = await execInInstance(containerName, 'caddy', ['version']);
        const version = stdout.trim().split(' ')[0] || 'unknown';
        logger.debug(`Caddy version detected`, { version });
        return version;
    } catch (err) {
        logger.warn(`Could not detect Caddy version`, { error: err.message });
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
    const adminUrl = req.instance.adminUrl;
    try {
        const [config, metricsText, upstreamChecks] = await Promise.allSettled([
            getServers(adminUrl),
            fetch(`${adminUrl}/metrics`, { headers: { 'Origin': 'http://0.0.0.0:2019' } })
                .then(r => r.ok ? r.text() : null).catch(() => null),
            getUpstreamChecks(adminUrl),
        ]);

        // Configuration establishes availability; metrics and upstream checks are optional.
        if (config.status === 'rejected') throw config.reason;

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

        // Same checks as Routes/Metrics, counting each upstream once even when
        // several routes share it
        let upstreamsOnline = null;
        let upstreamsTotal = null;
        if (upstreamChecks.status === 'fulfilled') {
            const results = [...resultsByUpstream(upstreamChecks.value.checks).values()];
            upstreamsTotal = results.length;
            upstreamsOnline = results.filter(Boolean).length;
        }

        res.json({
            online: true,
            instance: { id: req.instance.id, name: req.instance.name },
            serverCount: servers.length,
            routeCount,
            upstreamsOnline,
            upstreamsTotal,
            uptime,
            tlsEnabled: true,
            // Integration tokens receive monitoring aggregates, not connection
            // details from the management configuration.
            ...(!req.apiToken ? { servers, adminUrl } : {}),
        });
    } catch (err) {
        const error = asAppError(err, 'CADDY_STATUS_UNAVAILABLE', { instanceId: req.instance.id });
        res.locals.appError = error;
        res.json({ online: false, error: 'Caddy status unavailable', code: error.code });
    }
});

// GET /api/status/process
router.get('/process', async (req, res) => {
    const adminUrl = req.instance.adminUrl;
    try {
        const [metricsRes, version] = await Promise.all([
            fetch(`${adminUrl}/metrics`, { headers: { 'Origin': 'http://0.0.0.0:2019' } }),
            getCaddyVersion(req.instance.containerName),
        ]);
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

        res.json({ ok: true, version, uptime, uptimeSeconds, memAlloc, memSys, lastReload, lastReloadSuccess });
    } catch (err) {
        const error = asAppError(err, 'METRICS_UNAVAILABLE', { instanceId: req.instance.id });
        res.locals.appError = error;
        res.json({ ok: false, error: 'Metrics unavailable', code: error.code });
    }
});

export default router;
export { parsePrometheusMetrics, formatUptime };

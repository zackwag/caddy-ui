import { Router } from 'express';
import { execInInstance } from '../docker.js';
import logger from '../logger.js';
import { asAppError } from '../AppError.js';
import { formatUptime, readCaddyMetrics, summarizeProcess, uptimeSeconds } from '../caddyMetrics.js';
import { sendFailure } from '../errorReporting.js';
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

// GET /api/status
router.get('/', async (req, res) => {
    const adminUrl = req.instance.adminUrl;
    const [config, metrics, upstreamChecks] = await Promise.allSettled([
        getServers(adminUrl),
        readCaddyMetrics(adminUrl),
        getUpstreamChecks(adminUrl),
    ]);

    // Configuration establishes availability; metrics and upstream checks are optional.
    if (config.status === 'rejected') {
        const error = asAppError(config.reason, 'CADDY_STATUS_UNAVAILABLE', { instanceId: req.instance.id });
        return sendFailure(res, error, { online: false, error: 'Caddy status unavailable' }, 200);
    }

    const servers = Object.entries(config.value || {}).map(([name, server]) => ({
        name,
        listen: server.listen,
        routeCount: (server.routes || []).length,
    }));
    const uptime = metrics.status === 'fulfilled' ? uptimeSeconds(metrics.value) : null;
    // Same checks as Routes/Metrics, counting each upstream once even when
    // several routes share it
    const upstreams = upstreamChecks.status === 'fulfilled' ? resultsByUpstream(upstreamChecks.value.checks) : null;

    res.json({
        online: true,
        instance: { id: req.instance.id, name: req.instance.name },
        serverCount: servers.length,
        routeCount: servers.reduce((sum, server) => sum + server.routeCount, 0),
        upstreamsOnline: upstreams ? upstreams.filter(result => result.online).length : null,
        upstreamsTotal: upstreams ? upstreams.length : null,
        uptime: uptime !== null ? formatUptime(uptime) : null,
        tlsEnabled: true,
        // Integration tokens receive monitoring aggregates, not connection
        // details from the management configuration.
        ...(!req.apiToken ? { servers, adminUrl } : {}),
    });
});

// GET /api/status/process
router.get('/process', async (req, res) => {
    try {
        const [samples, version] = await Promise.all([
            readCaddyMetrics(req.instance.adminUrl),
            getCaddyVersion(req.instance.containerName),
        ]);
        res.json({ ok: true, version, ...summarizeProcess(samples) });
    } catch (err) {
        const error = asAppError(err, 'METRICS_UNAVAILABLE', { instanceId: req.instance.id });
        sendFailure(res, error, { ok: false, error: 'Metrics unavailable' }, 200);
    }
});

export default router;

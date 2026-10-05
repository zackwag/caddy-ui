import { Router } from 'express';
import { getRouteFailures, ROUTE_CHECK_INTERVAL_MS } from '../routeMonitor.js';
import { getHistory, getStatsForInstance, recordCheck } from '../uptimeHistory.js';
import { checkInstanceUpstreams, resultsByUpstream } from '../upstreamChecks.js';
import { CHECK_INTERVAL_MS } from '../upstreamMonitor.js';

const router = Router();

// GET /api/health
router.get('/', async (req, res) => {
    const { adminUrl, id: instanceId } = req.instance;
    try {
        const checks = await checkInstanceUpstreams(adminUrl);
        const checkedAt = new Date().toISOString();
        for (const [upstream, online] of resultsByUpstream(checks)) recordCheck(instanceId, upstream, online);
        res.json(checks.map((check) => ({
            domain: check.domain,
            upstream: check.upstream,
            server: check.server,
            online: check.online,
            checkedAt,
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/health/uptime[?kind=route] -- uptime stats per upstream, or per
// route host when route checks are on
router.get('/uptime', async (req, res) => {
    if (req.query.kind !== 'route') return res.json(getStatsForInstance(req.instance.id));
    // Route stats also carry why the latest check failed, when it did
    const stats = getStatsForInstance(req.instance.id, 'route');
    const failures = getRouteFailures(req.instance.id);
    for (const [host, s] of Object.entries(stats)) if (s && failures[host]) s.lastFailure = failures[host];
    res.json(stats);
});

// GET /api/health/history?upstream=<upstream>|route=<host>&since=<epochMs> --
// raw timestamped checks for the route status history modal, plus how often
// they're taken so the timeline can tell a gap from normal spacing
router.get('/history', async (req, res) => {
    const { upstream, route, since } = req.query;
    if (!upstream && !route) return res.status(400).json({ error: 'upstream or route is required' });
    const sinceMs = since ? Number(since) : undefined;
    const kind = route ? 'route' : 'upstream';
    const intervalMs = route ? ROUTE_CHECK_INTERVAL_MS : CHECK_INTERVAL_MS;
    res.json({ ...getHistory(req.instance.id, route || upstream, { sinceMs, kind }), intervalMs });
});

export default router;

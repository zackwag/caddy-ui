import { Router } from 'express';
import { getUpstreamChecks } from '../observations.js';
import { getRouteFailures, ROUTE_CHECK_INTERVAL_MS } from '../routeMonitor.js';
import { getHistory, getStatsForInstance } from '../uptimeHistory.js';
import { CHECK_INTERVAL_MS } from '../upstreamMonitor.js';

const router = Router();

// GET /api/health -- recent checks (shared with other requests and the
// monitor for up to OBSERVATION_MAX_AGE_MS) that are not recorded. Uptime
// history is sampled only by upstreamMonitor at a fixed cadence, so how often
// browsers poll this can't skew the uptime percentages.
router.get('/', async (req, res) => {
    const { adminUrl } = req.instance;
    try {
        const observed = await getUpstreamChecks(adminUrl);
        const checks = observed.checks;
        const checkedAt = observed.checkedAt.toISOString();
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

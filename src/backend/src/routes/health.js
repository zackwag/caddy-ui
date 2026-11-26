import { Router } from 'express';
import { AppError } from '../AppError.js';
import { getUpstreamChecks } from '../observations.js';
import { instanceUptime, PROBES } from '../monitoring.js';
import { getHistory } from '../uptimeHistory.js';

const router = Router();

// GET /api/health -- recent checks (shared with other requests and the
// monitor for up to OBSERVATION_MAX_AGE_MS) that are not recorded. Uptime
// history is sampled only by the monitor at a fixed cadence, so how often
// browsers poll this can't skew the uptime percentages.
router.get('/', async (req, res) => {
    const { checks, checkedAt } = await getUpstreamChecks(req.instance.adminUrl);
    res.json(checks.map(({ domain, upstream, server, online }) => ({ domain, upstream, server, online, checkedAt: checkedAt.toISOString() })));
});

// GET /api/health/uptime[?kind=route] -- uptime stats per upstream, or per
// route host when route checks are on
router.get('/uptime', async (req, res) => {
    res.json(instanceUptime(req.instance.id, req.query.kind === 'route' ? 'route' : 'upstream'));
});

// GET /api/health/history?upstream=<upstream>|route=<host>&since=<epochMs> --
// raw timestamped checks for the route status history modal, plus how often
// they're taken so the timeline can tell a gap from normal spacing
router.get('/history', async (req, res) => {
    const { upstream, route, since } = req.query;
    if (!upstream && !route) {
        throw new AppError('VALIDATION_FAILED', { context: { field: 'upstream' } });
    }
    const sinceMs = since ? Number(since) : undefined;
    const kind = route ? 'route' : 'upstream';
    res.json({ ...getHistory(req.instance.id, route || upstream, { sinceMs, kind }), intervalMs: PROBES[kind].intervalMs });
});

export default router;

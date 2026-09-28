import { Router } from 'express';
import { getHistory, getStatsForInstance, recordCheck } from '../uptimeHistory.js';
import { checkInstanceUpstreams } from '../upstreamChecks.js';

const router = Router();

// GET /api/health
router.get('/', async (req, res) => {
    const { adminUrl, id: instanceId } = req.instance;
    try {
        const checks = await checkInstanceUpstreams(adminUrl);
        const checkedAt = new Date().toISOString();
        res.json(checks.map((check) => {
            recordCheck(instanceId, check.upstream, check.online);
            return {
                domain: check.domain,
                upstream: check.upstream,
                server: check.server,
                online: check.online,
                checkedAt,
            };
        }));
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

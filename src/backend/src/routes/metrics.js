import { Router } from 'express';
import { AppError, asAppError } from '../AppError.js';
import { caddyMetrics } from '../caddy.js';
import { changeResultFields, readCaddyfile, saveCaddyfileChange } from '../caddyfileChange.js';
import { metricsEnabled, setMetricsEnabled } from '../caddyfileMetrics.js';
import { readCaddyMetrics, summarizeRequests } from '../caddyMetrics.js';
import { sendFailure } from '../errorReporting.js';
import { getInstances } from '../instances.js';
import logger from '../logger.js';
import { uptimeSnapshot } from '../monitoring.js';
import { buildRawMetrics } from '../uptimeMetrics.js';

const router = Router();

// GET /api/metrics/raw -- Prometheus scrape endpoint
export async function rawMetrics(req, res) {
    let caddyText = '';
    let caddyError = null;
    try {
        caddyText = await caddyMetrics(req.instance.adminUrl);
    } catch (err) {
        caddyError = err.message;
    }
    const { instances: uptimeInstances, staleMs } = uptimeSnapshot(getInstances().filter(inst => !req.apiToken || req.apiToken.instanceIds.includes(inst.id)));
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(buildRawMetrics({ instanceId: req.instance.id, caddyText, caddyError, uptimeInstances, staleMs }));
}

// GET /api/metrics -- parsed metrics for the UI
export async function metricsSummary(req, res) {
    try {
        const samples = await readCaddyMetrics(req.instance.adminUrl);
        res.json({ ok: true, ...summarizeRequests(samples), scrapedAt: new Date().toISOString() });
    } catch (err) {
        const error = asAppError(err, 'METRICS_UNAVAILABLE', { instanceId: req.instance.id });
        sendFailure(res, error, { ok: false, error: 'Metrics unavailable' }, 200);
    }
}

// GET /api/metrics/config
router.get('/config', async (req, res) => {
    const content = await readCaddyfile(req.instance);
    try {
        res.json({ enabled: metricsEnabled(content) });
    } catch (err) {
        throw asAppError(err, 'METRICS_CONFIG_FAILED', { instanceId: req.instance.id });
    }
});

// PUT /api/metrics/config
router.put('/config', async (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
        throw new AppError('VALIDATION_FAILED', { context: { field: 'enabled' } });
    }
    logger.info('Metrics config update requested', { enabled });
    let result;
    try {
        result = await saveCaddyfileChange(req.instance, previous => setMetricsEnabled(previous, enabled),
            { actor: req.actor, action: 'metrics.configure' });
    } catch (err) {
        throw asAppError(err, 'METRICS_CONFIG_FAILED', { instanceId: req.instance.id });
    }
    logger.info('Metrics config saved and reloaded', { enabled });
    res.json({ ok: true, enabled, ...changeResultFields(result) });
});

export default router;

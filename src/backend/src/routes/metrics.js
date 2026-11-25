import { Router } from 'express';
import { asAppError } from '../AppError.js';
import { caddyMetrics } from '../caddy.js';
import { changeResultFields, saveCaddyfileChange } from '../caddyfileChange.js';
import { metricsEnabled, setMetricsEnabled } from '../caddyfileMetrics.js';
import { readCaddyMetrics, summarizeRequests } from '../caddyMetrics.js';
import { readContainerFile } from '../containerFs.js';
import { sendFailure } from '../errorReporting.js';
import { getInstances } from '../instances.js';
import logger from '../logger.js';
import { PROBES } from '../monitoring.js';
import { getStatsForInstance } from '../uptimeHistory.js';
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
    const uptimeInstances = getInstances().filter(inst => !req.apiToken || req.apiToken.instanceIds.includes(inst.id)).map(({ id, name }) => ({
        id,
        name,
        stats: Object.fromEntries(Object.keys(PROBES).map(kind => [kind, getStatsForInstance(id, kind)])),
    }));
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(buildRawMetrics({ instanceId: req.instance.id, caddyText, caddyError, uptimeInstances }));
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
    let content;
    try {
        content = await readContainerFile(req.instance.containerName, req.instance.configPath);
    } catch (err) {
        throw asAppError(err, 'CADDYFILE_READ_FAILED', { instanceId: req.instance.id });
    }
    try {
        res.json({ enabled: metricsEnabled(content) });
    } catch (err) {
        throw asAppError(err, 'METRICS_CONFIG_FAILED', { instanceId: req.instance.id });
    }
});

// PUT /api/metrics/config
router.put('/config', async (req, res) => {
    const { enabled } = req.body;
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

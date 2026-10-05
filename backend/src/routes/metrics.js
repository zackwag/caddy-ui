import { Router } from 'express';
import { readContainerFile, writeContainerFile } from '../containerFs.js';
import { caddyLoad } from '../caddy.js';
import { getInstances } from '../instances.js';
import logger from '../logger.js';
import { ROUTE_CHECK_INTERVAL_MS } from '../routeMonitor.js';
import { getStatsForInstance } from '../uptimeHistory.js';

const router = Router();

// Targets whose last recorded check is older than this are left out of the
// scrape: they've been removed from the config (or excluded from route
// checks), their instance is unreachable, or checks were turned off, and
// exporting their last known state would read as current. Route checks run
// every 5 minutes, so they get proportionally more slack.
const UPTIME_STALE_MS = 5 * 60 * 1000;
const ROUTE_UPTIME_STALE_MS = Math.max(UPTIME_STALE_MS, ROUTE_CHECK_INTERVAL_MS * 2.5);

function uptimeFamilies(kind) {
    return [
        { name: `caddy_ui_${kind}_up`, help: `Result of the most recent ${kind} check (1 = online, 0 = offline)`, value: s => (s.currentlyOnline ? 1 : 0) },
        { name: `caddy_ui_${kind}_uptime_ratio`, help: `Fraction of retained ${kind} checks that were online`, value: s => s.online / s.total },
        { name: `caddy_ui_${kind}_state_duration_seconds`, help: `Seconds the ${kind} has been in its current online/offline state`, value: s => s.streakSeconds },
    ];
}

// Upstream series come from each instance's `stats`, route series (labeled
// by site host) from `routeStats`.
const UPTIME_KINDS = [
    { kind: 'upstream', statsKey: 'stats', staleMs: UPTIME_STALE_MS, families: uptimeFamilies('upstream') },
    { kind: 'route', statsKey: 'routeStats', staleMs: ROUTE_UPTIME_STALE_MS, families: uptimeFamilies('route') },
];

function escapeLabelValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatLabels(labels) {
    return Object.entries(labels).map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(',');
}

// Renders upstream and route uptime history as Prometheus text exposition.
// Takes [{ id, name, stats, routeStats }] where stats/routeStats are
// getStatsForInstance()'s result for each kind.
function formatUptimeMetrics(instances, now = Date.now()) {
    let out = '';
    for (const { kind, statsKey, staleMs, families } of UPTIME_KINDS) {
        const series = [];
        for (const inst of instances) {
            for (const [target, stats] of Object.entries(inst[statsKey] || {})) {
                if (!stats || now - stats.lastCheckAt.getTime() > staleMs) continue;
                series.push({ labels: formatLabels({ instance_id: inst.id, instance_name: inst.name ?? '', [kind]: target }), stats });
            }
        }
        for (const family of families) {
            out += `# HELP ${family.name} ${family.help}\n# TYPE ${family.name} gauge\n`;
            for (const { labels, stats } of series) out += `${family.name}{${labels}} ${family.value(stats)}\n`;
        }
    }
    return out;
}

// Full /api/metrics/raw body: Caddy's own metrics for the requested instance
// (when reachable), then caddy-ui's uptime series for every instance. Uptime
// is served even when Caddy's metrics are off, with caddy_ui_caddy_metrics_up
// standing in for the 503 this endpoint used to return.
function buildRawMetrics({ instanceId, caddyText, caddyError, uptimeInstances, now = Date.now() }) {
    let out = '';
    if (caddyError) out += `# Caddy metrics unavailable: ${caddyError.replace(/\s+/g, ' ')}\n`;
    else if (caddyText) out += caddyText.endsWith('\n') ? caddyText : `${caddyText}\n`;
    out += '# HELP caddy_ui_caddy_metrics_up Whether Caddy\'s /metrics endpoint could be scraped for this instance\n';
    out += '# TYPE caddy_ui_caddy_metrics_up gauge\n';
    out += `caddy_ui_caddy_metrics_up{${formatLabels({ instance_id: instanceId })}} ${caddyError ? 0 : 1}\n`;
    out += formatUptimeMetrics(uptimeInstances, now);
    return out;
}

// GET /api/metrics/raw -- Prometheus scrape endpoint. Mounted directly in
// index.js (not on this router) so it can skip auth for public metrics.
export async function rawMetrics(req, res) {
    let caddyText = '';
    let caddyError = null;
    try {
        const metricsRes = await fetch(`${req.instance.adminUrl}/metrics`, {
            headers: { 'Origin': 'http://0.0.0.0:2019' },
        });
        if (!metricsRes.ok) throw new Error(`Metrics unavailable: ${metricsRes.status}`);
        caddyText = await metricsRes.text();
    } catch (err) {
        caddyError = err.message;
    }
    const uptimeInstances = getInstances().map(inst => ({
        id: inst.id,
        name: inst.name,
        stats: getStatsForInstance(inst.id),
        routeStats: getStatsForInstance(inst.id, 'route'),
    }));
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(buildRawMetrics({ instanceId: req.instance.id, caddyText, caddyError, uptimeInstances }));
}

// GET /api/metrics -- parsed metrics for the UI
router.get('/', async (req, res) => {
    const adminUrl = req.instance.adminUrl;
    try {
        const metricsRes = await fetch(`${adminUrl}/metrics`, {
            headers: { 'Origin': 'http://0.0.0.0:2019' },
        });
        if (!metricsRes.ok) throw new Error(`Metrics unavailable: ${metricsRes.status}`);
        const text = await metricsRes.text();

        const buckets = {};
        const sums = {};
        const counts = {};

        for (const line of text.split('\n')) {
            if (line.startsWith('#') || !line.trim()) continue;

            const bucketMatch = line.match(/caddy_http_request_duration_seconds_bucket\{([^}]+)\}\s+([\d.e+]+)/);
            if (bucketMatch) {
                const labels = Object.fromEntries(bucketMatch[1].split(',').map(l => l.trim().split('=').map(s => s.replace(/"/g, ''))));
                if (labels.handler !== 'subroute') continue;
                const key = `${labels.code}:${labels.method}:${labels.server}`;
                if (!buckets[key]) buckets[key] = { labels };
                buckets[key][labels.le] = parseFloat(bucketMatch[2]);
                continue;
            }

            const sumMatch = line.match(/caddy_http_request_duration_seconds_sum\{([^}]+)\}\s+([\d.e+]+)/);
            if (sumMatch) {
                const labels = Object.fromEntries(sumMatch[1].split(',').map(l => l.trim().split('=').map(s => s.replace(/"/g, ''))));
                if (labels.handler !== 'subroute') continue;
                sums[`${labels.code}:${labels.method}:${labels.server}`] = parseFloat(sumMatch[2]);
                continue;
            }

            const countMatch = line.match(/caddy_http_request_duration_seconds_count\{([^}]+)\}\s+([\d.e+]+)/);
            if (countMatch) {
                const labels = Object.fromEntries(countMatch[1].split(',').map(l => l.trim().split('=').map(s => s.replace(/"/g, ''))));
                if (labels.handler !== 'subroute') continue;
                counts[`${labels.code}:${labels.method}:${labels.server}`] = parseFloat(countMatch[2]);
                continue;
            }
        }

        const statusGroups = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
        let totalRequests = 0;
        let totalSum = 0;

        for (const [key, count] of Object.entries(counts)) {
            const code = key.split(':')[0];
            const group = `${code[0]}xx`;
            if (statusGroups[group] !== undefined) statusGroups[group] += count;
            totalRequests += count;
            totalSum += sums[key] || 0;
        }

        const avgResponseMs = totalRequests > 0 ? Math.round((totalSum / totalRequests) * 1000) : 0;

        const LES = ['0.005', '0.01', '0.025', '0.05', '0.1', '0.25', '0.5', '1', '2.5', '5', '10', '+Inf'];
        const aggBuckets = {};
        for (const le of LES) aggBuckets[le] = 0;
        for (const bucketData of Object.values(buckets)) {
            for (const le of LES) {
                if (bucketData[le] !== undefined) aggBuckets[le] += bucketData[le];
            }
        }

        function interpolatePercentile(pct) {
            const total = aggBuckets['+Inf'];
            if (!total) return 0;
            const target = pct * total;
            for (let i = 0; i < LES.length - 1; i++) {
                const le = LES[i];
                const leNext = LES[i + 1];
                if (aggBuckets[le] >= target) return Math.round(parseFloat(le) * 1000);
                if (aggBuckets[leNext] >= target) {
                    const leLow = parseFloat(le);
                    const leHigh = parseFloat(leNext === '+Inf' ? le : leNext);
                    const countLow = aggBuckets[le];
                    const countHigh = aggBuckets[leNext];
                    if (countHigh === countLow) return Math.round(leLow * 1000);
                    const frac = (target - countLow) / (countHigh - countLow);
                    return Math.round((leLow + frac * (leHigh - leLow)) * 1000);
                }
            }
            return Math.round(parseFloat(LES[LES.length - 2]) * 1000);
        }

        const p50 = interpolatePercentile(0.5);
        const p95 = interpolatePercentile(0.95);
        const p99 = interpolatePercentile(0.99);

        const startTimeMatch = text.match(/process_start_time_seconds\s+([\d.e+]+)/);
        const startTime = startTimeMatch ? parseFloat(startTimeMatch[1]) : null;
        const uptimeSeconds = startTime ? Math.floor(Date.now() / 1000 - startTime) : null;
        const rps = uptimeSeconds && uptimeSeconds > 0 ? Math.round((totalRequests / uptimeSeconds) * 100) / 100 : null;

        res.json({ ok: true, totalRequests, statusGroups, avgResponseMs, p50, p95, p99, rps, uptimeSeconds, scrapedAt: new Date().toISOString() });
    } catch (err) {
        res.json({ ok: false, error: err.message });
    }
});

// GET /api/metrics/config
router.get('/config', async (req, res) => {
    try {
        const content = await readContainerFile(req.instance.containerName, req.instance.configPath);
        const enabled = /^\s*metrics\s*$/m.test(content);
        res.json({ enabled });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/metrics/config
router.put('/config', async (req, res) => {
    const { enabled } = req.body;
    const { configPath, containerName } = req.instance;
    try {
        let content = await readContainerFile(containerName, configPath);
        if (enabled) {
            if (/^\s*metrics\s*$/m.test(content)) return res.json({ ok: true, message: 'Metrics already enabled' });
            content = content.replace(/^(\s*\{)/m, '$1\n    metrics');
        } else {
            content = content.replace(/^\s*metrics\s*\n?/m, '');
        }
        logger.info(`Metrics config update requested`, { enabled });
        await writeContainerFile(containerName, configPath, content);
        await caddyLoad(content, req.instance.adminUrl);
        logger.info(`Metrics config saved and reloaded`, { enabled });
        res.json({ ok: true, enabled });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export { buildRawMetrics, formatUptimeMetrics };
export default router;

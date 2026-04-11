import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { caddyLoad } from '../caddy.js';

const router = Router();

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

// GET /api/metrics -- parsed metrics for the UI
router.get('/', async (req, res) => {
    try {
        const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || 'http://caddy:2019';
        const metricsRes = await fetch(`${CADDY_ADMIN_URL}/metrics`, {
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
        const content = await readFile(process.env.CADDY_CONFIG_PATH || '/etc/caddy/Caddyfile', 'utf8');
        const enabled = /^\s*metrics\s*$/m.test(content);
        res.json({ enabled });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/metrics/config
router.put('/config', async (req, res) => {
    const { enabled } = req.body;
    const CADDY_CONFIG_PATH = process.env.CADDY_CONFIG_PATH || '/etc/caddy/Caddyfile';
    try {
        let content = await readFile(CADDY_CONFIG_PATH, 'utf8');
        if (enabled) {
            if (/^\s*metrics\s*$/m.test(content)) return res.json({ ok: true, message: 'Metrics already enabled' });
            content = content.replace(/^(\s*\{)/m, '$1\n    metrics');
        } else {
            content = content.replace(/^\s*metrics\s*\n?/m, '');
        }
        await writeFile(CADDY_CONFIG_PATH, content, 'utf8');
        await caddyLoad(content);
        res.json({ ok: true, enabled });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;

import { caddyMetrics } from './caddy.js';
import { metricValue, parseMetrics } from './prometheus.js';

// What Caddy's own metrics say about an instance, read in one place so the
// Dashboard, Metrics page and status API agree.

export async function readCaddyMetrics(adminUrl) {
    return parseMetrics(await caddyMetrics(adminUrl));
}

// Seconds since Caddy started, or null when its metrics don't say.
export function uptimeSeconds(samples, now = Date.now()) {
    const startedAt = metricValue(samples, 'process_start_time_seconds');
    return startedAt ? Math.floor(now / 1000 - startedAt) : null;
}

export function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) {return `${d}d ${h}h ${m}m`;}
    if (h > 0) {return `${h}h ${m}m`;}
    if (m > 0) {return `${m}m`;}
    return `${seconds}s`;
}

const REQUEST_DURATION = 'caddy_http_request_duration_seconds';

// Milliseconds, from histogram buckets: [[upperBoundSeconds, cumulativeCount]],
// ascending. Interpolated within the bucket the percentile falls in.
function percentileMs(buckets, pct) {
    const total = buckets.at(-1)?.[1];
    if (!total) {
        return 0;
    }
    const target = pct * total;
    const index = buckets.findIndex(([, count]) => count >= target);
    const [bound, count] = buckets[index];
    const [lowerBound, lowerCount] = buckets[index - 1] ?? [bound, count];
    if (index === 0 || bound === Infinity) {
        return Math.round(lowerBound * 1000);
    }
    return Math.round((lowerBound + (target - lowerCount) / (count - lowerCount) * (bound - lowerBound)) * 1000);
}

// Totals over every request Caddy has served. Only the subroute handler is
// counted: a request passes through several handlers, and each reports it.
export function summarizeRequests(samples, now = Date.now()) {
    const ofMetric = suffix => samples.filter(sample => sample.name === `${REQUEST_DURATION}_${suffix}` && sample.labels.handler === 'subroute');

    const statusGroups = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    let totalRequests = 0;
    for (const { labels, value } of ofMetric('count')) {
        const group = `${labels.code?.[0]}xx`;
        if (statusGroups[group] !== undefined) {
            statusGroups[group] += value;
        }
        totalRequests += value;
    }
    const totalSeconds = ofMetric('sum').reduce((sum, { value }) => sum + value, 0);

    const counts = new Map();
    for (const { labels, value } of ofMetric('bucket')) {
        const bound = labels.le === '+Inf' ? Infinity : Number(labels.le);
        counts.set(bound, (counts.get(bound) || 0) + value);
    }
    const buckets = [...counts].sort(([a], [b]) => a - b);

    const uptime = uptimeSeconds(samples, now);
    return {
        totalRequests,
        statusGroups,
        avgResponseMs: totalRequests > 0 ? Math.round((totalSeconds / totalRequests) * 1000) : 0,
        p50: percentileMs(buckets, 0.5),
        p95: percentileMs(buckets, 0.95),
        p99: percentileMs(buckets, 0.99),
        rps: uptime && uptime > 0 ? Math.round((totalRequests / uptime) * 100) / 100 : null,
        uptimeSeconds: uptime,
    };
}

const megabytes = bytes => (bytes ? Math.round(bytes / 1024 / 1024 * 10) / 10 : null);

export function summarizeProcess(samples, now = Date.now()) {
    const uptime = uptimeSeconds(samples, now);
    const reloadedAt = metricValue(samples, 'caddy_config_last_reload_success_timestamp_seconds');
    return {
        uptime: uptime !== null ? formatUptime(uptime) : null,
        uptimeSeconds: uptime,
        memAlloc: megabytes(metricValue(samples, 'go_memstats_alloc_bytes')),
        memSys: megabytes(metricValue(samples, 'go_memstats_sys_bytes')),
        lastReload: reloadedAt ? new Date(reloadedAt * 1000).toISOString() : null,
        lastReloadSuccess: metricValue(samples, 'caddy_config_last_reload_successful') === 1,
    };
}

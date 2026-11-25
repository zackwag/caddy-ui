import { PROBES } from './monitoring.js';
import { formatGauge, formatLabels } from './prometheus.js';

// Targets whose last recorded check is stale are left out of the scrape:
// they've been removed from the config (or excluded from route checks), their
// instance is unreachable, or checks were turned off, and exporting their last
// known state would read as current.

function uptimeFamilies(kind) {
    return [
        { name: `caddy_ui_${kind}_up`, help: `Result of the most recent ${kind} check (1 = online, 0 = offline)`, value: s => (s.currentlyOnline ? 1 : 0) },
        { name: `caddy_ui_${kind}_uptime_ratio`, help: `Fraction of retained ${kind} checks that were online`, value: s => s.online / s.total },
        { name: `caddy_ui_${kind}_state_duration_seconds`, help: `Seconds the ${kind} has been in its current online/offline state`, value: s => s.streakSeconds },
    ];
}

// Uptime history as Prometheus text exposition, from [{ id, name, stats }] where
// stats holds getStatsForInstance()'s result per kind. Each series is labeled
// with its target: the upstream, or the route's site host.
export function formatUptimeMetrics(instances, now = Date.now()) {
    let out = '';
    for (const [kind, { staleMs }] of Object.entries(PROBES)) {
        const series = [];
        for (const { id, name, stats: byKind } of instances) {
            for (const [target, stats] of Object.entries(byKind[kind] || {})) {
                if (!stats || now - stats.lastCheckAt.getTime() > staleMs) continue;
                series.push({ labels: formatLabels({ instance_id: id, instance_name: name ?? '', [kind]: target }), stats });
            }
        }
        for (const { name, help, value } of uptimeFamilies(kind)) {
            out += formatGauge(name, help, series.map(({ labels, stats }) => ({ labels, value: value(stats) })));
        }
    }
    return out;
}

// Full /api/metrics/raw body: Caddy's own metrics for the requested instance
// (when reachable), then caddy-ui's uptime series for every instance in
// `uptimeInstances`. Uptime is served even when Caddy's metrics are off, with
// caddy_ui_caddy_metrics_up standing in for the 503 this endpoint used to return.
export function buildRawMetrics({ instanceId, caddyText, caddyError, uptimeInstances, now = Date.now() }) {
    let out = '';
    if (caddyError) out += `# Caddy metrics unavailable: ${caddyError.replace(/\s+/g, ' ')}\n`;
    else if (caddyText) out += caddyText.endsWith('\n') ? caddyText : `${caddyText}\n`;
    out += formatGauge('caddy_ui_caddy_metrics_up', 'Whether Caddy\'s /metrics endpoint could be scraped for this instance',
        [{ labels: formatLabels({ instance_id: instanceId }), value: caddyError ? 0 : 1 }]);
    return out + formatUptimeMetrics(uptimeInstances, now);
}

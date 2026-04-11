import { useCallback, useEffect, useState } from "react";
import { API, apiFetch } from "../utils/api.js";

export default function Metrics({ toast, onUnauth }) {
    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [configOpen, setConfigOpen] = useState(false);
    const [metricsConfig, setMetricsConfig] = useState(null);
    const [savingMetrics, setSavingMetrics] = useState(false);
    const [publicMetrics, setPublicMetrics] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        apiFetch("/metrics", {}, onUnauth)
            .then(setMetrics)
            .catch(() => setMetrics({ ok: false, error: "Failed to fetch metrics" }))
            .finally(() => setLoading(false));
    }, [onUnauth]);

    useEffect(() => {
        load();
        apiFetch("/metrics/config", {}, onUnauth).then(setMetricsConfig).catch(() => { });
        fetch(`${API}/auth/status`).then(r => r.json()).then(d => setPublicMetrics(d.publicMetrics || false)).catch(() => { });
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, [load]);

    const toggleMetrics = async (enabled) => {
        setSavingMetrics(true);
        try {
            await apiFetch("/metrics/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }, onUnauth);
            setMetricsConfig({ enabled });
            toast.success(enabled ? "Metrics enabled" : "Metrics disabled");
            if (enabled) setTimeout(load, 1000);
        } catch (e) { toast.error(e.message); }
        finally { setSavingMetrics(false); }
    };

    const statusColors = { '2xx': 'var(--accent)', '3xx': 'var(--accent2)', '4xx': 'var(--warn)', '5xx': 'var(--danger)' };

    const formatScrapedAt = (iso) => {
        if (!iso) return "";
        const ts = iso.endsWith('Z') ? iso : iso + 'Z';
        return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    };

    return (
        <div className="gap-16">
            <div className="card card-flush">
                <div className={`card-header--clickable ${configOpen ? "is-open" : ""}`} onClick={() => setConfigOpen(o => !o)}>
                    <span className="section-label">Metrics Configuration</span>
                    <div className="flex-center">
                        {metricsConfig && <span className={`badge ${metricsConfig.enabled ? "badge-green" : "badge-muted"}`}>{metricsConfig.enabled ? "ENABLED" : "DISABLED"}</span>}
                        <span className="chevron">{configOpen ? "▲" : "▼"}</span>
                    </div>
                </div>
                {configOpen && (
                    <div className="card-body">
                        <div className="flex-between" style={{ marginBottom: 16 }}>
                            <div>
                                <span className="field-label">Caddy Metrics</span>
                                <div className="hint" style={{ marginBottom: 0 }}>Enables the Prometheus metrics endpoint on Caddy's admin API</div>
                            </div>
                            <button className={`btn ${metricsConfig?.enabled ? "btn-danger" : "btn-primary"}`} onClick={() => toggleMetrics(!metricsConfig?.enabled)} disabled={savingMetrics}>
                                {savingMetrics ? "Saving..." : metricsConfig?.enabled ? "Disable" : "Enable"}
                            </button>
                        </div>
                        <div className="config-section-divider">
                            <div className="flex-between">
                                <div>
                                    <span className="field-label">Public Metrics Endpoint</span>
                                    <div className="hint" style={{ marginBottom: 0 }}>
                                        {publicMetrics ? <>Scrape URL: <span style={{ color: "var(--accent2)" }}>http://caddy-ui-backend:3001/api/metrics/raw</span></> : "Set CADDY_UI_PUBLIC_METRICS=true to enable unauthenticated Prometheus scraping"}
                                    </div>
                                </div>
                                <span className={`badge ${publicMetrics ? "badge-green" : "badge-muted"}`}>{publicMetrics ? "ENABLED" : "DISABLED"}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {loading ? (
                <div className="loading">Loading metrics...</div>
            ) : !metrics?.ok ? (
                <div className="card">
                    <div className="flex-between">
                        <span className="loading">Metrics not enabled</span>
                        <button className="btn btn-ghost btn--sm" onClick={() => setConfigOpen(true)}>Enable in Metrics →</button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="grid-3">
                        <div className="card">
                            <div className="card-title">Total Requests</div>
                            <div className="stat-val">{metrics.totalRequests.toLocaleString()}</div>
                            <div className="stat-label">Since process start</div>
                        </div>
                        <div className="card">
                            <div className="card-title">Requests / sec</div>
                            <div className="stat-val data-val--accent">{metrics.rps ?? "—"}</div>
                            <div className="stat-label">Avg over uptime</div>
                        </div>
                        <div className="card">
                            <div className="card-title">Avg Response</div>
                            <div className="stat-val" style={{ color: metrics.avgResponseMs > 500 ? "var(--warn)" : "var(--text)" }}>
                                {metrics.avgResponseMs}<span className="ms-unit">ms</span>
                            </div>
                            <div className="stat-label">Mean response time</div>
                        </div>
                    </div>

                    <div className="grid-2">
                        <div className="card">
                            <div className="card-title">Status Codes</div>
                            <div className="metrics-bar-wrap">
                                {Object.entries(metrics.statusGroups).map(([group, count]) => {
                                    const pct = Math.round((count / (metrics.totalRequests || 1)) * 100);
                                    return (
                                        <div key={group} className="metrics-bar-row">
                                            <div className="metrics-bar-label" style={{ color: statusColors[group] }}>{group}</div>
                                            <div className="metrics-bar-track">
                                                <div className="metrics-bar-fill" style={{ width: `${pct}%`, background: statusColors[group] }} />
                                            </div>
                                            <div className="metrics-bar-count">{count}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="card">
                            <div className="card-title">Response Time Percentiles</div>
                            <div className="percentile-rows">
                                {[
                                    { label: "p50", val: metrics.p50, color: "var(--accent)" },
                                    { label: "p95", val: metrics.p95, color: "var(--warn)" },
                                    { label: "p99", val: metrics.p99, color: "var(--danger)" },
                                ].map(({ label, val, color }) => (
                                    <div key={label}>
                                        <div className="percentile-header">
                                            <span className="percentile-label">{label}</span>
                                            <span className="percentile-val" style={{ color }}>{val}<span className="percentile-unit">ms</span></span>
                                        </div>
                                        <div className="percentile-bar-track">
                                            <div className="percentile-bar-fill" style={{ width: `${Math.min(100, (val / (metrics.p99 || 1)) * 100)}%`, background: color }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="metrics-footer">
                        <span className="metrics-footer-label">Refreshes every 30s</span>
                        <div className="btn-row">
                            <span>Last scraped: {formatScrapedAt(metrics.scrapedAt)}</span>
                            <button className="btn btn-ghost btn--sm" onClick={load}>↺ Refresh</button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

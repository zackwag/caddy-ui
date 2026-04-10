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
        apiFetch("/status/metrics-parsed", {}, onUnauth)
            .then(setMetrics)
            .catch(() => setMetrics({ ok: false, error: "Failed to fetch metrics" }))
            .finally(() => setLoading(false));
    }, [onUnauth]);

    useEffect(() => {
        load();
        apiFetch("/status/metrics-config", {}, onUnauth).then(setMetricsConfig).catch(() => { });
        fetch(`${API}/auth/status`).then(r => r.json()).then(d => setPublicMetrics(d.publicMetrics || false)).catch(() => { });
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, [load]);

    const toggleMetrics = async (enabled) => {
        setSavingMetrics(true);
        try {
            await apiFetch("/status/metrics-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }, onUnauth);
            setMetricsConfig({ enabled });
            toast.success(enabled ? "Metrics enabled" : "Metrics disabled");
            if (enabled) setTimeout(load, 1000);
        } catch (e) { toast.error(e.message); }
        finally { setSavingMetrics(false); }
    };

    const labelStyle = { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--muted)", letterSpacing: "1.2px", textTransform: "uppercase", marginBottom: 4, display: "block" };
    const statusColors = { '2xx': 'var(--accent)', '3xx': 'var(--accent2)', '4xx': 'var(--warn)', '5xx': 'var(--danger)' };

    const formatScrapedAt = (iso) => {
        if (!iso) return "";
        const ts = iso.endsWith('Z') ? iso : iso + 'Z';
        return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    };

    return (
        <div className="gap-16">
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div onClick={() => setConfigOpen(o => !o)} style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none", borderBottom: configOpen ? "1px solid var(--border)" : "none" }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--muted)" }}>Metrics Configuration</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {metricsConfig && <span className={`badge ${metricsConfig.enabled ? "badge-green" : "badge-muted"}`}>{metricsConfig.enabled ? "ENABLED" : "DISABLED"}</span>}
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>{configOpen ? "▲" : "▼"}</span>
                    </div>
                </div>
                {configOpen && (
                    <div style={{ padding: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
                            <div>
                                <span style={labelStyle}>Caddy Metrics</span>
                                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)" }}>Enables the Prometheus metrics endpoint on Caddy's admin API</div>
                            </div>
                            <button className={`btn ${metricsConfig?.enabled ? "btn-danger" : "btn-primary"}`} onClick={() => toggleMetrics(!metricsConfig?.enabled)} disabled={savingMetrics}>
                                {savingMetrics ? "Saving..." : metricsConfig?.enabled ? "Disable" : "Enable"}
                            </button>
                        </div>
                        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                                <div>
                                    <span style={labelStyle}>Public Metrics Endpoint</span>
                                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)" }}>
                                        {publicMetrics ? <>Scrape URL: <span style={{ color: "var(--accent2)" }}>http://caddy-ui-backend:3001/api/metrics</span></> : "Set CADDY_UI_PUBLIC_METRICS=true to enable unauthenticated Prometheus scraping"}
                                    </div>
                                </div>
                                <span className={`badge ${publicMetrics ? "badge-green" : "badge-muted"}`}>{publicMetrics ? "ENABLED" : "DISABLED"}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {loading ? (
                <div style={{ color: "var(--muted)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Loading metrics...</div>
            ) : !metrics?.ok ? (
                <div className="card">
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <span>Metrics not enabled — enable above to see request data</span>
                        <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setConfigOpen(true)}>Configure →</button>
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
                            <div className="stat-val" style={{ color: "var(--accent)" }}>{metrics.rps ?? "—"}</div>
                            <div className="stat-label">Avg over uptime</div>
                        </div>
                        <div className="card">
                            <div className="card-title">Avg Response</div>
                            <div className="stat-val" style={{ color: metrics.avgResponseMs > 500 ? "var(--warn)" : "var(--text)" }}>
                                {metrics.avgResponseMs}<span style={{ fontSize: 14, color: "var(--muted)", marginLeft: 4 }}>ms</span>
                            </div>
                            <div className="stat-label">Mean response time</div>
                        </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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
                            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                                {[
                                    { label: "p50", val: metrics.p50, color: "var(--accent)" },
                                    { label: "p95", val: metrics.p95, color: "var(--warn)" },
                                    { label: "p99", val: metrics.p99, color: "var(--danger)" },
                                ].map(({ label, val, color }) => (
                                    <div key={label}>
                                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)" }}>{label}</span>
                                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color }}>{val}<span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 3 }}>ms</span></span>
                                        </div>
                                        <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                                            <div style={{ height: "100%", width: `${Math.min(100, (val / (metrics.p99 || 1)) * 100)}%`, background: color, borderRadius: 2, transition: "width 0.4s" }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--muted)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>Refreshes every 30s</span>
                        <div className="btn-row">
                            <span>Last scraped: {formatScrapedAt(metrics.scrapedAt)}</span>
                            <button className="btn btn-ghost" onClick={load} style={{ fontSize: 11 }}>↺ Refresh</button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

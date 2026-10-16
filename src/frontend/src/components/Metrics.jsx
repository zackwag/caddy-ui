import { localizeError } from "../utils/errorMessages.js";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { API, apiFetch } from "../utils/api.js";
import { currentLocale, formatNumber } from "../utils/format.js";
import UpstreamUptime from "./UpstreamUptime.jsx";

// eslint-disable-next-line i18next/no-literal-string -- Prometheus scrape endpoint
const PUBLIC_METRICS_URL = "http://caddy-ui-backend:3001/api/metrics/raw";

export default function Metrics({ toast, onUnauth, routeChecks, onRouteChecksChange, routeCheckExcludes, onRouteCheckExcludesChange }) {
    const { t, i18n } = useTranslation();
    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [configOpen, setConfigOpen] = useState(false);
    const [metricsConfig, setMetricsConfig] = useState(null);
    const [savingMetrics, setSavingMetrics] = useState(false);
    const [publicMetrics, setPublicMetrics] = useState(false);
    const [refreshError, setRefreshError] = useState(null);

    const load = useCallback(() => {
        setLoading(true);
        apiFetch("/metrics", {}, onUnauth)
            .catch(e => ({ ok: false, error: i18n.t('metrics.fetchFailed'), code: e.code, requestId: e.requestId }))
            .then(res => {
                // Keep the last good numbers through a failed refresh so a blip
                // doesn't swap the cards for the "not enabled" card
                setMetrics(prev => res.ok || !prev?.ok ? res : prev);
                setRefreshError(res.ok ? null : localizeError(res, i18n.t));
            })
            .finally(() => setLoading(false));
    }, [onUnauth, i18n]);

    useEffect(() => {
        load();
        apiFetch("/metrics/config", {}, onUnauth).then(setMetricsConfig).catch(() => { });
        fetch(`${API}/auth/status`).then(r => r.json()).then(d => setPublicMetrics(d.publicMetrics || false)).catch(() => { });
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, [load, onUnauth]);

    const toggleMetrics = async (enabled) => {
        setSavingMetrics(true);
        try {
            await apiFetch("/metrics/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }, onUnauth);
            setMetricsConfig({ enabled });
            toast.success(enabled ? t("metrics.enabledToast") : t("metrics.disabledToast"));
            if (enabled) setTimeout(load, 1000);
            else setMetrics({ ok: false, error: t("metrics.disabledToast") });
        } catch (e) { toast.error(localizeError(e, t), e); }
        finally { setSavingMetrics(false); }
    };

    const statusColors = { '2xx': 'var(--accent)', '3xx': 'var(--accent2)', '4xx': 'var(--warn)', '5xx': 'var(--danger)' };

    const formatScrapedAt = (iso) => {
        if (!iso) return "";
        const ts = iso.endsWith('Z') ? iso : iso + 'Z';
        return new Date(ts).toLocaleTimeString(currentLocale(), { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    };

    return (
        <div className="gap-16">
            <div className="card card-flush">
                <div className={`card-header--clickable ${configOpen ? "is-open" : ""}`} onClick={() => setConfigOpen(o => !o)}>
                    <span className="section-label">{t("metrics.configuration")}</span>
                    <div className="flex-center">
                        {metricsConfig && <span className={`badge ${metricsConfig.enabled ? "badge-green" : "badge-muted"}`}>{metricsConfig.enabled ? t("common.enabledUpper") : t("common.disabledUpper")}</span>}
                        <span className="chevron">{configOpen ? "▲" : "▼"}</span>
                    </div>
                </div>
                {configOpen && (
                    <div className="card-body">
                        <div className="flex-between" style={{ marginBottom: 16 }}>
                            <div>
                                <span className="field-label">{t("metrics.caddyMetrics")}</span>
                                <div className="hint" style={{ marginBottom: 0 }}>{t("metrics.caddyMetricsHint")}</div>
                            </div>
                            <button className={`btn metrics-toggle-btn ${metricsConfig?.enabled ? "btn-danger" : "btn-primary"}`} onClick={() => toggleMetrics(!metricsConfig?.enabled)} disabled={savingMetrics}>
                                {savingMetrics ? t("common.saving") : metricsConfig?.enabled ? t("common.disable") : t("common.enable")}
                            </button>
                        </div>
                        <div className="config-section-divider">
                            <div className="flex-between">
                                <div>
                                    <span className="field-label">{t("metrics.publicEndpoint")}</span>
                                    <div className="hint" style={{ marginBottom: 0 }}>
                                        {publicMetrics ? <>{t("metrics.scrapeUrl")} <span style={{ color: "var(--accent2)" }}>{PUBLIC_METRICS_URL}</span></> : t("metrics.publicMetricsHint")}
                                    </div>
                                </div>
                                <span className="metrics-status-text" style={{ color: publicMetrics ? "var(--accent)" : "var(--muted)" }}>
                                    {publicMetrics ? t("common.enabled") : t("common.disabled")}
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {!metrics ? (
                <div className="loading">{t("metrics.loading")}</div>
            ) : !metrics.ok ? (
                <div className="card">
                    <div className="flex-between">
                        <span className="loading">{t("metrics.notEnabled")}</span>
                        <button className="btn btn-ghost btn--sm" onClick={() => setConfigOpen(true)}>{t("metrics.enableInMetrics")} →</button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="grid-3">
                        <div className="card">
                            <div className="card-title">{t("metrics.totalRequests")}</div>
                            <div className="stat-val">{formatNumber(metrics.totalRequests)}</div>
                            <div className="stat-label">{t("metrics.sinceProcessStart")}</div>
                        </div>
                        <div className="card">
                            <div className="card-title">{t("metrics.requestsPerSecond")}</div>
                            <div className="stat-val data-val--accent">{metrics.rps != null ? formatNumber(metrics.rps) : "—"}</div>
                            <div className="stat-label">{t("metrics.avgOverUptime")}</div>
                        </div>
                        <div className="card">
                            <div className="card-title">{t("metrics.avgResponse")}</div>
                            <div className="stat-val" style={{ color: metrics.avgResponseMs > 500 ? "var(--warn)" : "var(--text)" }}>
                                {formatNumber(metrics.avgResponseMs)}<span className="ms-unit">ms</span>
                            </div>
                            <div className="stat-label">{t("metrics.meanResponseTime")}</div>
                        </div>
                    </div>

                    <div className="grid-2">
                        <div className="card">
                            <div className="card-title">{t("metrics.statusCodes")}</div>
                            <div className="metrics-bar-wrap">
                                {Object.entries(metrics.statusGroups).map(([group, count]) => {
                                    const pct = Math.round((count / (metrics.totalRequests || 1)) * 100);
                                    return (
                                        <div key={group} className="metrics-bar-row">
                                            <div className="metrics-bar-label" style={{ color: statusColors[group] }}>{group}</div>
                                            <div className="metrics-bar-track">
                                                <div className="metrics-bar-fill" style={{ width: `${pct}%`, background: statusColors[group] }} />
                                            </div>
                                            <div className="metrics-bar-count">{formatNumber(count)}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="card">
                            <div className="card-title">{t("metrics.responsePercentiles")}</div>
                            <div className="percentile-rows">
                                {[
                                    { label: "p50", val: metrics.p50, color: "var(--accent)" },
                                    { label: "p95", val: metrics.p95, color: "var(--warn)" },
                                    { label: "p99", val: metrics.p99, color: "var(--danger)" },
                                ].map(({ label, val, color }) => (
                                    <div key={label}>
                                        <div className="percentile-header">
                                            <span className="percentile-label">{label}</span>
                                            <span className="percentile-val" style={{ color }}>{formatNumber(val)}<span className="percentile-unit">ms</span></span>
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
                        <span className="metrics-footer-label">{t("metrics.refreshInterval")}</span>
                        <div className="btn-row">
                            {refreshError && <span style={{ color: "var(--warn)" }} title={refreshError}>{t("metrics.refreshFailed")}</span>}
                            <span>{t("metrics.lastScraped", { time: formatScrapedAt(metrics.scrapedAt) })}</span>
                            <button className="btn btn-ghost btn--sm" onClick={load} disabled={loading}>↺ {loading ? t("common.refreshing") : t("common.refresh")}</button>
                        </div>
                    </div>
                </>
            )}

            <UpstreamUptime
                onUnauth={onUnauth}
                routeChecks={routeChecks}
                onRouteChecksChange={onRouteChecksChange}
                routeCheckExcludes={routeCheckExcludes}
                onRouteCheckExcludesChange={onRouteCheckExcludesChange}
            />
        </div>
    );
}

import { localizeError } from "../utils/errorMessages.js";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../utils/api.js";
import { currentLocale, formatNumber, formatPercent } from "../utils/format.js";
import { summarizeHistory } from "../utils/uptimeHistory.js";

const RANGES = [
    { label: "1h", ms: 60 * 60 * 1000 },
    { label: "6h", ms: 6 * 60 * 60 * 1000 },
    { label: "24h", ms: 24 * 60 * 60 * 1000 },
    { label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
];

// Gaps in the recorded checks longer than this (backend restart, container
// down, etc.) render as "unknown" instead of extending the last known status.
// Checks taken less often (route checks) get a proportionally longer threshold.
const GAP_THRESHOLD_MS = 3 * 60 * 1000;
const GAP_INTERVAL_MULTIPLIER = 2.5;
const REFRESH_INTERVAL_MS = 30_000;
const AXIS_TICK_COUNT = 4;

function buildAxisTicks(rangeStart, rangeEnd) {
    const ticks = [];
    for (let i = 0; i <= AXIS_TICK_COUNT; i++) {
        ticks.push({ ms: rangeStart + ((rangeEnd - rangeStart) * i) / AXIS_TICK_COUNT, isNow: i === AXIS_TICK_COUNT });
    }
    return ticks;
}

function formatAxisTime(ms, rangeMs) {
    const d = new Date(ms);
    return rangeMs > 24 * 60 * 60 * 1000
        ? d.toLocaleDateString(currentLocale(), { month: "short", day: "numeric" })
        : d.toLocaleTimeString(currentLocale(), { hour: "numeric", minute: "2-digit" });
}

function formatRelativeTime(ms, t) {
    const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (diffSec < 5) return t("routeHistory.justNow");
    if (diffSec < 60) return t("routeHistory.secondsAgo", { count: diffSec });
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return t("routeHistory.minutesAgo", { count: diffMin });
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return t("routeHistory.hoursAgo", { count: diffHr });
    return t("routeHistory.daysAgo", { count: Math.round(diffHr / 24) });
}

function formatActivityTime(ms) {
    return new Date(ms).toLocaleString(currentLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
}

/* eslint-disable i18next/no-literal-string -- Intl unit option identifiers; Intl supplies the localized labels. */
function formatDuration(ms) {
    const seconds = ms / 1000;
    const [value, unit] = seconds >= 86400 ? [seconds / 86400, "day"]
        : seconds >= 3600 ? [seconds / 3600, "hour"]
            : seconds >= 60 ? [seconds / 60, "minute"] : [seconds, "second"];
    return new Intl.NumberFormat(currentLocale(), { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: unit === "second" ? 0 : 1 }).format(value);
}
/* eslint-enable i18next/no-literal-string */

const STATUS_LABEL_KEYS = { online: "routeHistory.online", offline: "routeHistory.offline", unknown: "routeHistory.noData" };

// Shows one target's history: an upstream, or a route host when route checks
// are on (pass `route` instead of `upstream`).
export default function RouteHistoryModal({ title, upstream, route, onUnauth, onClose }) {
    const { t } = useTranslation();
    const [range, setRange] = useState(RANGES[2]);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [entries, setEntries] = useState(null);
    const [intervalMs, setIntervalMs] = useState(0);
    const [error, setError] = useState(null);
    const [focus, setFocus] = useState(null);
    const target = route || upstream;

    useEffect(() => {
        let cancelled = false;
        const load = () => {
            const since = Date.now() - range.ms;
            const param = route ? `route=${encodeURIComponent(route)}` : `upstream=${encodeURIComponent(upstream)}`;
            apiFetch(`/health/history?${param}&since=${since}`, {}, onUnauth)
                .then(data => { if (!cancelled) { setEntries(data.entries); setIntervalMs(data.intervalMs || 0); setError(null); } })
                .catch(e => { if (!cancelled) setError(e); });
        };
        load();
        if (!autoRefresh) return () => { cancelled = true; };
        const timer = setInterval(load, REFRESH_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(timer); };
    }, [upstream, route, range, autoRefresh, onUnauth]);

    const now = Date.now();
    const overviewStart = now - range.ms;
    const rangeStart = focus ? Math.max(focus.start, overviewStart) : overviewStart;
    const rangeEnd = focus ? Math.max(rangeStart + 1, Math.min(focus.end, now)) : now;
    const gapThresholdMs = Math.max(GAP_THRESHOLD_MS, intervalMs * GAP_INTERVAL_MULTIPLIER);
    const history = useMemo(() => summarizeHistory(entries || [], rangeStart, rangeEnd, gapThresholdMs), [entries, rangeStart, rangeEnd, gapThresholdMs]);
    const ticks = useMemo(() => buildAxisTicks(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

    const lastCheck = entries && entries.length > 0 ? entries[entries.length - 1] : null;
    const lastStatus = lastCheck ? (now - lastCheck.at > gapThresholdMs ? "unknown" : lastCheck.online ? "online" : "offline") : null;
    const incidentLabel = incident => t("routeHistory.incidentTitle", {
        start: formatActivityTime(incident.start), duration: formatDuration(incident.end - incident.start),
    });
    function inspectIncident(incident) {
        setFocus({ start: Math.max(overviewStart, incident.start - 5 * 60_000), end: Math.min(now, incident.end + 5 * 60_000) });
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal history-modal" role="dialog" aria-modal="true" aria-label={title || target} onClick={e => e.stopPropagation()}>
                <div className="modal-title">{title || target}</div>
                {title && title !== target && <div className="modal-hint mono" style={{ marginTop: -14, marginBottom: 8 }}>{target}</div>}

                {entries && (
                    <div className="history-header">
                        <div className="history-header-left">
                            <span
                                className={lastStatus && lastStatus !== "unknown" ? "health-dot" : "health-dot health-dot--none"}
                                style={lastStatus && lastStatus !== "unknown" ? { background: lastStatus === "online" ? "var(--accent)" : "var(--danger)" } : undefined}
                            />
                            <span className="history-header-relative">{lastCheck ? formatRelativeTime(lastCheck.at, t) : t("routeHistory.noDataYet")}</span>
                        </div>
                        {lastStatus && <span className={`history-header-status history-header-status--${lastStatus}`}>{t(STATUS_LABEL_KEYS[lastStatus])}</span>}
                    </div>
                )}

                <div className="history-controls">
                    <div className="history-range-picker">
                        {RANGES.map(r => (
                            <button
                                key={r.label}
                                className={`btn btn--sm ${!focus && range.label === r.label ? "btn-primary" : "btn-ghost"}`}
                                onClick={() => { setRange(r); setFocus(null); }}
                            >{r.label}</button>
                        ))}
                    </div>
                    <label className="history-auto-refresh">
                        <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
                        {t("routeHistory.autoRefresh")}
                    </label>
                </div>

                {error ? (
                    <div className="card-empty">{localizeError(error, t)}</div>
                ) : entries === null ? (
                    <div className="loading">{t("common.loading")}</div>
                ) : (
                    <>
                        {focus && <div className="history-focus">
                            <span>{t("routeHistory.focusedInterval")}</span>
                            <button className="btn btn-ghost btn--sm" onClick={() => setFocus(null)}>{t("routeHistory.backToOverview")}</button>
                        </div>}
                        <div className="history-timeline-wrap">
                            <div className="history-timeline" aria-label={t("routeHistory.observedTimeline")}>
                                {history.segments.map((seg, i) => (
                                    <div
                                        key={i}
                                        className={`history-segment history-segment--${seg.status}`}
                                        style={{ flexGrow: seg.end - seg.start }}
                                        title={t("routeHistory.segmentTitle", { status: t(STATUS_LABEL_KEYS[seg.status]), start: new Date(seg.start).toLocaleString(currentLocale()), end: new Date(seg.end).toLocaleString(currentLocale()) })}
                                    />
                                ))}
                            </div>
                            {history.incidents.map(incident => (
                                <button key={incident.start} className="history-outage-marker"
                                    style={{ left: `clamp(6px, ${(incident.start - rangeStart) / (rangeEnd - rangeStart) * 100}%, calc(100% - 6px))` }}
                                    title={incidentLabel(incident)} aria-label={incidentLabel(incident)}
                                    onClick={() => inspectIncident(incident)} />
                            ))}
                        </div>
                        <div className="history-timeline-axis">
                            {ticks.map((tick, i) => (
                                <span key={i} className="history-axis-tick" style={{ left: `${(i / AXIS_TICK_COUNT) * 100}%` }}>
                                    {tick.isNow && !focus ? t("routeHistory.now") : formatAxisTime(tick.ms, rangeEnd - rangeStart)}
                                </span>
                            ))}
                        </div>

                        <div className="history-legend">
                            {Object.entries(STATUS_LABEL_KEYS).map(([status, key]) => <span key={status}>
                                <i className={`history-legend-dot history-segment--${status}`} />{t(key)}
                            </span>)}
                            <span className="history-marker-hint">{t("routeHistory.markerHint")}</span>
                        </div>
                        <div className="history-stats">
                            <div>
                                <span className="history-stat-label">{t("routeHistory.successfulChecks")}</span>
                                <span className="history-stat-val">{history.successPct !== null ? formatPercent(history.successPct) : "—"}</span>
                            </div>
                            <div>
                                <span className="history-stat-label">{t("routeHistory.outages")}</span>
                                <span className={`history-stat-val${history.incidents.length ? " history-stat-val--danger" : ""}`}>{formatNumber(history.incidents.length)}</span>
                            </div>
                            <div>
                                <span className="history-stat-label">{t("routeHistory.estimatedDowntime")}</span>
                                <span className="history-stat-val">{history.checks ? formatDuration(history.downtimeMs) : "—"}</span>
                            </div>
                            <div>
                                <span className="history-stat-label">{t("routeHistory.longestOutage")}</span>
                                <span className="history-stat-val">{history.checks ? formatDuration(history.longestMs) : "—"}</span>
                            </div>
                        </div>
                        <div className="history-coverage">{t("routeHistory.observationSummary", { checks: formatNumber(history.checks), coverage: formatPercent(history.coveragePct) })}
                            {history.unknownMs > 0 && <> · {t("routeHistory.unobserved", { duration: formatDuration(history.unknownMs) })}</>}
                        </div>
                        <div className="history-section-label">{t("routeHistory.incidents")}</div>
                        <div className="history-incident-list">
                            {history.incidents.length === 0 ? (
                                <div className="history-activity-empty">{t("routeHistory.noOutages")}</div>
                            ) : [...history.incidents].reverse().map(incident => (
                                <button key={incident.start} className="history-incident" onClick={() => inspectIncident(incident)} title={t("routeHistory.inspectIncident")}>
                                    <span className="history-incident-dot" />
                                    <span className="history-incident-details">
                                        <span className="history-incident-start">{formatActivityTime(incident.start)}</span>
                                        <span className="history-incident-recovery">{incident.recoveredAt
                                            ? t("routeHistory.recoveredAt", { time: formatActivityTime(incident.recoveredAt) })
                                            : t(incident.monitoringGap ? "routeHistory.recoveryGap" : "routeHistory.noRecovery")}</span>
                                    </span>
                                    <span className="history-incident-duration">{formatDuration(incident.end - incident.start)}</span>
                                    <span className="history-incident-inspect">{t("routeHistory.inspectIncident")}</span>
                                </button>
                            ))}
                        </div>
                        <p className="history-estimate-hint">{t("routeHistory.estimateHint")}</p>
                    </>
                )}

                <div className="btn-row flex-end" style={{ marginTop: 20 }}>
                    <button className="btn btn-ghost" onClick={onClose}>{t("common.close")}</button>
                </div>
            </div>
        </div>
    );
}

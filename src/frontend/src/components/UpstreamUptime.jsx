import { localizeError } from "../utils/errorMessages.js";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouteStatuses } from "../hooks/useRouteStatuses.js";
import HealthDot from "./HealthDot.jsx";
import RouteHistoryModal from "./RouteHistoryModal.jsx";
import { formatDuration, formatPercent, formatPercentParts } from "../utils/format.js";
import { compareUptime, getRouteHost, getRouteTitle, STATUS_LABEL_KEYS } from "../utils/routes.js";

const isTracked = status => status !== "unknown" && status !== "none";

// Big stat number with the percent sign in the smaller unit style, wherever
// the language puts it.
const PercentStat = ({ value }) => formatPercentParts(value).map((part, i) => (
    part.isSign ? <span key={i} className="ms-unit">{part.text}</span> : part.text
));

const uptimeColor = (pct) => pct >= 99 ? "var(--accent)" : pct >= 95 ? "var(--warn)" : "var(--danger)";

// Routes with something to check, from the backend's recorded uptime stats.
function buildRows(routes, statusOf, notes) {
    const rows = [];
    for (const route of routes) {
        const status = statusOf(route);
        if (!status.upstreams.length && !status.probeHost) {
            continue;
        }
        const domain = getRouteHost(route);
        rows.push({ ...status, domain, note: notes[domain] || "", title: getRouteTitle(route, notes[domain]) });
    }
    // Worst uptime first; routes with no data yet sink to the bottom
    return rows.sort((a, b) => compareUptime(a, b) || a.domain.localeCompare(b.domain));
}

function summarize(rows) {
    const tracked = rows.filter(r => isTracked(r.status));
    const withPct = rows.filter(r => r.pct !== null);
    const count = (s) => rows.filter(r => r.status === s).length;
    return {
        tracked: tracked.length,
        online: count("online"),
        partial: count("partial"),
        offline: count("offline"),
        avgPct: withPct.length ? Math.round(withPct.reduce((sum, r) => sum + r.pct, 0) / withPct.length * 10) / 10 : null,
        lowest: withPct[0] || null,
    };
}

export default function UpstreamUptime({ toast, routeChecks, onRouteChecksChange, routeCheckExcludes, onRouteCheckExcludesChange }) {
    const { t } = useTranslation();
    const { routes, routesError: error, notes, excludes, statusOf } = useRouteStatuses({ toast, routeChecks, routeCheckExcludes });
    const [historyModal, setHistoryModal] = useState(null);

    const rows = useMemo(() => buildRows(routes || [], statusOf, notes), [routes, statusOf, notes]);

    const toggleExclude = (host) => {
        const key = host.toLowerCase();
        onRouteCheckExcludesChange(excludes.has(key) ? routeCheckExcludes.filter(h => h !== key) : [...routeCheckExcludes, key]);
    };
    const summary = useMemo(() => summarize(rows), [rows]);

    const onlineColor = !summary.tracked ? "var(--muted)"
        : summary.online === summary.tracked ? "var(--accent)"
            : summary.online > 0 ? "var(--warn)" : "var(--danger)";
    const onlineDetail = [
        summary.offline && t("uptime.offlineCount", { count: summary.offline }),
        summary.partial && t("uptime.partialCount", { count: summary.partial }),
    ].filter(Boolean).join(" · ") || (summary.tracked ? t(routeChecks ? "uptime.allRoutesResponding" : "uptime.allUpstreamsResponding") : t("uptime.waitingForChecks"));

    return (
        <>
            <div className="flex-between">
                <span className="section-label">{routeChecks ? t("uptime.routeUptime") : t("uptime.upstreamUptime")}</span>
                <button className="btn btn-ghost btn--sm" title={t("uptime.routeCheckHint")} onClick={() => onRouteChecksChange(!routeChecks)}>
                    {t("uptime.routeChecks")}: {routeChecks ? t("common.on") : t("common.off")}
                </button>
            </div>
            {routeChecks && <div className="hint" style={{ marginBottom: 0 }}>{t("uptime.routeCheckHint")}</div>}

            {error && !routes ? (
                <div className="card"><span className="loading">{t("uptime.failedToLoadRoutes", { error: localizeError(error, t) })}</span></div>
            ) : !routes ? (
                <div className="loading">{t("uptime.loading")}</div>
            ) : !rows.length ? (
                <div className="card"><span className="loading">{routeChecks ? t("uptime.noRoutesToCheck") : t("uptime.noRoutesWithUpstreams")}</span></div>
            ) : (
                <>
                    <div className="grid-3">
                        <div className="card">
                            <div className="card-title">{t("uptime.routesOnline")}</div>
                            <div className="stat-val" style={{ color: onlineColor }}>
                                {summary.online}<span className="ms-unit">/ {summary.tracked}</span>
                            </div>
                            <div className="stat-label">{onlineDetail}</div>
                        </div>
                        <div className="card">
                            <div className="card-title">{t("uptime.avgUptime")}</div>
                            <div className="stat-val" style={{ color: summary.avgPct !== null ? uptimeColor(summary.avgPct) : "var(--muted)" }}>
                                {summary.avgPct !== null ? <PercentStat value={summary.avgPct} /> : "—"}
                            </div>
                            <div className="stat-label">{t("uptime.acrossHistory")}</div>
                        </div>
                        <div className="card">
                            <div className="card-title">{t("uptime.lowestUptime")}</div>
                            <div className="stat-val" style={{ color: summary.lowest ? uptimeColor(summary.lowest.pct) : "var(--muted)" }}>
                                {summary.lowest ? <PercentStat value={summary.lowest.pct} /> : "—"}
                            </div>
                            <div className={`stat-label uptime-lowest-label${summary.lowest?.title && !summary.lowest.note ? " route-title--fallback" : ""}`} title={summary.lowest?.domain}>
                                {summary.lowest ? summary.lowest.title || summary.lowest.domain : t("uptime.noDataYet")}
                            </div>
                        </div>
                    </div>

                    <div className="card card-flush">
                        <div className="table-wrap">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th className="col-status">{t("uptime.status")}</th>
                                        <th>{t("uptime.route")}</th>
                                        <th>{t("uptime.upstream")}</th>
                                        <th className="uptime-col-bar">{t("uptime.uptime")}</th>
                                        <th>{t("uptime.currentStateFor")}</th>
                                        {routeChecks && <th className="col-status">{t("uptime.routeCheck")}</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((r, i) => {
                                        const showsUpstream = r.checkHost && r.upstreams.length > 0;
                                        const upstreamLabel = t("uptime.upstreamStatus", { status: t(STATUS_LABEL_KEYS[r.upstreamState]) });
                                        return (
                                            <tr
                                                key={`${r.domain}:${i}`}
                                                className="uptime-row"
                                                title={t("uptime.viewHistory")}
                                                onClick={() => setHistoryModal({ ...r.history, title: r.note || r.domain })}
                                            >
                                                <td className="col-status">
                                                    <HealthDot status={r.status} label={t(STATUS_LABEL_KEYS[r.status])} />
                                                </td>
                                                <td>
                                                    <span className="mono">{r.domain || "—"}</span>
                                                    {r.title && <div className={`cell-muted${!r.note ? " route-title--fallback" : ""}`}>{r.title}</div>}
                                                </td>
                                                <td className="mono" style={{ color: "var(--accent2)" }}>
                                                    {showsUpstream && (
                                                        <HealthDot status={r.upstreamState} label={upstreamLabel} className="uptime-upstream-dot" title={upstreamLabel} />
                                                    )}
                                                    {r.upstreams.join(", ") || <span className="cell-muted">—</span>}
                                                </td>
                                                <td className="uptime-col-bar">
                                                    {r.pct !== null ? (
                                                        <div className="metrics-bar-row">
                                                            <div className="metrics-bar-track">
                                                                <div className="metrics-bar-fill" style={{ width: `${r.pct}%`, background: uptimeColor(r.pct) }} />
                                                            </div>
                                                            <div className="metrics-bar-count uptime-pct">{formatPercent(r.pct)}</div>
                                                        </div>
                                                    ) : <span className="cell-muted">—</span>}
                                                </td>
                                                <td className={`mono health-text--${r.status}`}>
                                                    {r.stats ? `${t(STATUS_LABEL_KEYS[r.status])} · ${formatDuration(r.stats.streakSeconds * 1000)}` : "—"}
                                                    {r.failure && <div className="cell-muted uptime-failure" title={r.failure}>{r.failure}</div>}
                                                    {r.excluded && <div className="cell-muted">{t("uptime.routeCheckSkipped")}</div>}
                                                </td>
                                                {routeChecks && (
                                                    <td className="col-status">
                                                        {r.probeHost && (
                                                            <button
                                                                className="btn btn-ghost btn--sm"
                                                                title={r.excluded ? t("uptime.resumeChecks", { host: r.probeHost }) : t("uptime.stopChecks", { host: r.probeHost })}
                                                                onClick={e => { e.stopPropagation(); toggleExclude(r.probeHost); }}
                                                            >
                                                                {r.excluded ? t("uptime.check") : t("uptime.skip")}
                                                            </button>
                                                        )}
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {historyModal && <RouteHistoryModal {...historyModal} onClose={() => setHistoryModal(null)} />}
        </>
    );
}

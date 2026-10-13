import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import RouteHistoryModal from "./RouteHistoryModal.jsx";
import { apiFetch } from "../utils/api.js";
import { formatPercent, formatPercentParts } from "../utils/format.js";
import { getRouteCheckHost, getRouteHost, getRouteUpstreams } from "../utils/routes.js";

const STATUS = {
    online: { labelKey: "uptime.online", color: "var(--accent)" },
    partial: { labelKey: "uptime.partial", color: "var(--warn)" },
    offline: { labelKey: "uptime.offline", color: "var(--danger)" },
    unknown: { labelKey: "uptime.noData", color: null },
};

// Big stat number with the percent sign in the smaller unit style, wherever
// the language puts it.
const PercentStat = ({ value }) => formatPercentParts(value).map((part, i) => (
    part.isSign ? <span key={i} className="ms-unit">{part.text}</span> : part.text
));

const uptimeColor = (pct) => pct >= 99 ? "var(--accent)" : pct >= 95 ? "var(--warn)" : "var(--danger)";

function upstreamStatus(upstreams, uptime) {
    const known = upstreams.map(u => uptime[u]).filter(Boolean);
    const onlineCount = known.filter(s => s.currentlyOnline).length;
    return !known.length ? "unknown"
        : onlineCount === upstreams.length ? "online"
            : onlineCount > 0 ? "partial" : "offline";
}

// Joins live routes with the backend's recorded uptime stats. Like the Routes
// view, uptime % and history follow a route's first upstream, while status
// considers all of them. With route checks on, routes that can be requested
// by name use their own check instead, including routes with no upstream;
// the rest (wildcards, catch-alls) and excluded routes keep the upstream view.
function buildRows(routes, uptime, routeUptime, notes, routeChecks, excludes) {
    const rows = [];
    for (const route of routes) {
        const upstreams = getRouteUpstreams(route);
        const probeHost = routeChecks ? getRouteCheckHost(route) : null;
        const excluded = !!probeHost && excludes.has(probeHost.toLowerCase());
        const checkHost = excluded ? null : probeHost;
        if (!upstreams.length && !probeHost) continue;
        const domain = getRouteHost(route);
        const routeStats = checkHost ? routeUptime[checkHost] || null : null;
        const stats = checkHost ? routeStats : uptime[upstreams[0]] || null;
        const upstreamState = upstreams.length ? upstreamStatus(upstreams, uptime) : null;
        const status = !checkHost ? upstreamState || "unknown"
            : !routeStats ? "unknown"
                : routeStats.currentlyOnline ? "online" : "offline";
        rows.push({
            domain,
            title: notes[domain] || "",
            upstreams,
            probeHost,
            excluded,
            checkHost,
            status,
            upstreamState: checkHost ? upstreamState : null,
            // Route checks run every 5 minutes, so don't wait for a second one
            pct: stats && stats.total > (checkHost ? 0 : 1) ? stats.pct : null,
            streakLabel: stats?.streakLabel || null,
            failure: status === "offline" ? routeStats?.lastFailure || null : null,
        });
    }
    // Worst uptime first; routes with no data yet sink to the bottom
    return rows.sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || a.domain.localeCompare(b.domain));
}

function summarize(rows) {
    const tracked = rows.filter(r => r.status !== "unknown");
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

export default function UpstreamUptime({ onUnauth, routeChecks, onRouteChecksChange, routeCheckExcludes, onRouteCheckExcludesChange }) {
    const { t } = useTranslation();
    const [routes, setRoutes] = useState(null);
    const [uptime, setUptime] = useState({});
    const [routeUptime, setRouteUptime] = useState({});
    const [notes, setNotes] = useState({});
    const [error, setError] = useState(null);
    const [historyModal, setHistoryModal] = useState(null);

    const load = useCallback(() => {
        apiFetch("/routes", {}, onUnauth)
            .then(r => { setRoutes(r); setError(null); })
            .catch(e => setError(e.message));
        apiFetch("/health/uptime", {}, onUnauth).then(setUptime).catch(() => { });
        if (routeChecks) apiFetch("/health/uptime?kind=route", {}, onUnauth).then(setRouteUptime).catch(() => { });
        apiFetch("/route-notes", {}, onUnauth).then(setNotes).catch(() => { });
    }, [onUnauth, routeChecks]);

    useEffect(() => {
        load();
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, [load]);

    // Turning route checks on starts a round on the backend; pick up its
    // results once the probes (5s timeout each) have had time to finish
    useEffect(() => {
        if (!routeChecks) return;
        const t = setTimeout(load, 6000);
        return () => clearTimeout(t);
    }, [routeChecks, load]);

    const excludes = useMemo(() => new Set(routeCheckExcludes), [routeCheckExcludes]);
    const rows = useMemo(() => buildRows(routes || [], uptime, routeUptime, notes, routeChecks, excludes), [routes, uptime, routeUptime, notes, routeChecks, excludes]);

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
                <div className="card"><span className="loading">{t("uptime.failedToLoadRoutes", { error })}</span></div>
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
                            <div className="stat-label uptime-lowest-label" title={summary.lowest?.domain}>
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
                                        const s = STATUS[r.status];
                                        const u = r.upstreamState && STATUS[r.upstreamState];
                                        return (
                                            <tr
                                                key={`${r.domain}:${i}`}
                                                className="uptime-row"
                                                title={t("uptime.viewHistory")}
                                                onClick={() => setHistoryModal(r.checkHost
                                                    ? { route: r.checkHost, title: r.title || r.domain }
                                                    : { upstream: r.upstreams[0], title: r.title || r.domain })}
                                            >
                                                <td className="col-status">
                                                    <span
                                                        className={`health-dot${s.color ? "" : " health-dot--none"}`}
                                                        style={s.color ? { background: s.color, boxShadow: `0 0 4px ${s.color}` } : undefined}
                                                    >
                                                        <span className="sr-only">{t(s.labelKey)}</span>
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="mono">{r.domain}</span>
                                                    {r.title && <div className="cell-muted">{r.title}</div>}
                                                </td>
                                                <td className="mono" style={{ color: "var(--accent2)" }}>
                                                    {u && (
                                                        <span
                                                            className={`health-dot uptime-upstream-dot${u.color ? "" : " health-dot--none"}`}
                                                            style={u.color ? { background: u.color } : undefined}
                                                            title={t("uptime.upstreamStatus", { status: t(u.labelKey) })}
                                                        >
                                                            <span className="sr-only">{t("uptime.upstreamStatus", { status: t(u.labelKey) })}</span>
                                                        </span>
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
                                                <td className="mono" style={{ color: s.color || "var(--muted)" }}>
                                                    {r.streakLabel ? `${t(s.labelKey)} · ${r.streakLabel}` : "—"}
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

            {historyModal && (
                <RouteHistoryModal
                    upstream={historyModal.upstream}
                    route={historyModal.route}
                    title={historyModal.title}
                    onUnauth={onUnauth}
                    onClose={() => setHistoryModal(null)}
                />
            )}
        </>
    );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import RouteHistoryModal from "./RouteHistoryModal.jsx";
import { apiFetch } from "../utils/api.js";
import { getRouteHost, getRouteUpstreams } from "../utils/routes.js";

const STATUS = {
    online: { label: "Online", color: "var(--accent)" },
    partial: { label: "Partial", color: "var(--warn)" },
    offline: { label: "Offline", color: "var(--danger)" },
    unknown: { label: "No data", color: null },
};

const uptimeColor = (pct) => pct >= 99 ? "var(--accent)" : pct >= 95 ? "var(--warn)" : "var(--danger)";

// Joins live routes with the backend's recorded uptime stats. Like the Routes
// view, uptime % and history follow a route's first upstream, while status
// considers all of them.
function buildRows(routes, uptime, notes) {
    const rows = [];
    for (const route of routes) {
        const upstreams = getRouteUpstreams(route);
        if (!upstreams.length) continue;
        const domain = getRouteHost(route);
        const stats = uptime[upstreams[0]] || null;
        const known = upstreams.map(u => uptime[u]).filter(Boolean);
        const onlineCount = known.filter(s => s.currentlyOnline).length;
        const status = !known.length ? "unknown"
            : onlineCount === upstreams.length ? "online"
                : onlineCount > 0 ? "partial" : "offline";
        rows.push({
            domain,
            title: notes[domain] || "",
            upstreams,
            status,
            pct: stats && stats.total > 1 ? stats.pct : null,
            streakLabel: stats?.streakLabel || null,
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

export default function UpstreamUptime({ onUnauth }) {
    const [routes, setRoutes] = useState(null);
    const [uptime, setUptime] = useState({});
    const [notes, setNotes] = useState({});
    const [error, setError] = useState(null);
    const [historyModal, setHistoryModal] = useState(null);

    const load = useCallback(() => {
        apiFetch("/routes", {}, onUnauth)
            .then(r => { setRoutes(r); setError(null); })
            .catch(e => setError(e.message));
        apiFetch("/health/uptime", {}, onUnauth).then(setUptime).catch(() => { });
        apiFetch("/route-notes", {}, onUnauth).then(setNotes).catch(() => { });
    }, [onUnauth]);

    useEffect(() => {
        load();
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, [load]);

    const rows = useMemo(() => buildRows(routes || [], uptime, notes), [routes, uptime, notes]);
    const summary = useMemo(() => summarize(rows), [rows]);

    const onlineColor = !summary.tracked ? "var(--muted)"
        : summary.online === summary.tracked ? "var(--accent)"
            : summary.online > 0 ? "var(--warn)" : "var(--danger)";
    const onlineDetail = [
        summary.offline && `${summary.offline} offline`,
        summary.partial && `${summary.partial} partial`,
    ].filter(Boolean).join(" · ") || (summary.tracked ? "All upstreams responding" : "Waiting for first checks");

    return (
        <>
            <span className="section-label">Upstream Uptime</span>

            {error && !routes ? (
                <div className="card"><span className="loading">Failed to load routes: {error}</span></div>
            ) : !routes ? (
                <div className="loading">Loading upstream uptime...</div>
            ) : !rows.length ? (
                <div className="card"><span className="loading">No routes with upstreams</span></div>
            ) : (
                <>
                    <div className="grid-3">
                        <div className="card">
                            <div className="card-title">Routes Online</div>
                            <div className="stat-val" style={{ color: onlineColor }}>
                                {summary.online}<span className="ms-unit">/ {summary.tracked}</span>
                            </div>
                            <div className="stat-label">{onlineDetail}</div>
                        </div>
                        <div className="card">
                            <div className="card-title">Avg Uptime</div>
                            <div className="stat-val" style={{ color: summary.avgPct !== null ? uptimeColor(summary.avgPct) : "var(--muted)" }}>
                                {summary.avgPct ?? "—"}{summary.avgPct !== null && <span className="ms-unit">%</span>}
                            </div>
                            <div className="stat-label">Across recorded history</div>
                        </div>
                        <div className="card">
                            <div className="card-title">Lowest Uptime</div>
                            <div className="stat-val" style={{ color: summary.lowest ? uptimeColor(summary.lowest.pct) : "var(--muted)" }}>
                                {summary.lowest?.pct ?? "—"}{summary.lowest && <span className="ms-unit">%</span>}
                            </div>
                            <div className="stat-label uptime-lowest-label" title={summary.lowest?.domain}>
                                {summary.lowest ? summary.lowest.title || summary.lowest.domain : "No data yet"}
                            </div>
                        </div>
                    </div>

                    <div className="card card-flush">
                        <div className="table-wrap">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th className="col-status">Status</th>
                                        <th>Route</th>
                                        <th>Upstream</th>
                                        <th className="uptime-col-bar">Uptime</th>
                                        <th>Current State For</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((r, i) => {
                                        const s = STATUS[r.status];
                                        return (
                                            <tr
                                                key={`${r.domain}:${i}`}
                                                className="uptime-row"
                                                title="View status history"
                                                onClick={() => setHistoryModal({ upstream: r.upstreams[0], title: r.title || r.domain })}
                                            >
                                                <td className="col-status">
                                                    <span
                                                        className={`health-dot${s.color ? "" : " health-dot--none"}`}
                                                        style={s.color ? { background: s.color, boxShadow: `0 0 4px ${s.color}` } : undefined}
                                                    >
                                                        <span className="sr-only">{s.label}</span>
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="mono">{r.domain}</span>
                                                    {r.title && <div className="cell-muted">{r.title}</div>}
                                                </td>
                                                <td className="mono" style={{ color: "var(--accent2)" }}>{r.upstreams.join(", ")}</td>
                                                <td className="uptime-col-bar">
                                                    {r.pct !== null ? (
                                                        <div className="metrics-bar-row">
                                                            <div className="metrics-bar-track">
                                                                <div className="metrics-bar-fill" style={{ width: `${r.pct}%`, background: uptimeColor(r.pct) }} />
                                                            </div>
                                                            <div className="metrics-bar-count uptime-pct">{r.pct}%</div>
                                                        </div>
                                                    ) : <span className="cell-muted">—</span>}
                                                </td>
                                                <td className="mono" style={{ color: s.color || "var(--muted)" }}>
                                                    {r.streakLabel ? `${s.label} · ${r.streakLabel}` : "—"}
                                                </td>
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
                    title={historyModal.title}
                    onUnauth={onUnauth}
                    onClose={() => setHistoryModal(null)}
                />
            )}
        </>
    );
}

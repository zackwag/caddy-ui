import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../utils/api.js";

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

// Turns a sparse list of point-in-time checks into contiguous timeline
// segments spanning [rangeStart, rangeEnd], each labeled online/offline/unknown.
function buildSegments(entries, rangeStart, rangeEnd, gapThresholdMs) {
    const points = entries.filter(e => e.at < rangeEnd);
    if (!points.length) return [{ status: "unknown", start: rangeStart, end: rangeEnd }];

    const segments = [];
    let cursor = rangeStart;

    // Extends the previous segment instead of pushing a new one when the
    // status matches and they're back-to-back, so a long run of same-status
    // checks renders as one continuous bar rather than one sliver per check.
    const emit = (status, start, end) => {
        const last = segments[segments.length - 1];
        if (last && last.status === status && last.end === start) last.end = end;
        else segments.push({ status, start, end });
    };

    for (let i = 0; i < points.length; i++) {
        const at = Math.max(points[i].at, rangeStart);
        const nextAt = Math.min(i + 1 < points.length ? points[i + 1].at : rangeEnd, rangeEnd);

        if (at > cursor) emit("unknown", cursor, at);

        if (nextAt - at > gapThresholdMs) {
            const knownEnd = Math.min(at + gapThresholdMs, nextAt);
            emit(points[i].online ? "online" : "offline", at, knownEnd);
            if (nextAt > knownEnd) emit("unknown", knownEnd, nextAt);
        } else if (nextAt > at) {
            emit(points[i].online ? "online" : "offline", at, nextAt);
        }

        cursor = nextAt;
    }

    if (cursor < rangeEnd) emit("unknown", cursor, rangeEnd);
    return segments.filter(s => s.end > s.start);
}

// Points where status actually changed, most recent first. The first known
// check counts as a transition too, establishing the earliest known state.
function buildTransitions(entries) {
    const transitions = [];
    for (let i = 0; i < entries.length; i++) {
        if (i === 0 || entries[i].online !== entries[i - 1].online) transitions.push(entries[i]);
    }
    return transitions.reverse();
}

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
        ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatRelativeTime(ms) {
    const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (diffSec < 5) return "just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.round(diffHr / 24)}d ago`;
}

function formatActivityTime(ms) {
    return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
}

const STATUS_LABEL = { online: "Online", offline: "Offline", unknown: "No data" };

// Shows one target's history: an upstream, or a route host when route checks
// are on (pass `route` instead of `upstream`).
export default function RouteHistoryModal({ title, upstream, route, onUnauth, onClose }) {
    const [range, setRange] = useState(RANGES[2]);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [entries, setEntries] = useState(null);
    const [intervalMs, setIntervalMs] = useState(0);
    const [error, setError] = useState(null);
    const target = route || upstream;

    useEffect(() => {
        let cancelled = false;
        const load = () => {
            const since = Date.now() - range.ms;
            const param = route ? `route=${encodeURIComponent(route)}` : `upstream=${encodeURIComponent(upstream)}`;
            apiFetch(`/health/history?${param}&since=${since}`, {}, onUnauth)
                .then(data => { if (!cancelled) { setEntries(data.entries); setIntervalMs(data.intervalMs || 0); setError(null); } })
                .catch(e => { if (!cancelled) setError(e.message); });
        };
        load();
        if (!autoRefresh) return () => { cancelled = true; };
        const t = setInterval(load, REFRESH_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(t); };
    }, [upstream, route, range, autoRefresh, onUnauth]);

    const rangeEnd = Date.now();
    const rangeStart = rangeEnd - range.ms;
    const gapThresholdMs = Math.max(GAP_THRESHOLD_MS, intervalMs * GAP_INTERVAL_MULTIPLIER);
    const segments = useMemo(() => buildSegments(entries || [], rangeStart, rangeEnd, gapThresholdMs), [entries, rangeStart, rangeEnd, gapThresholdMs]);
    const ticks = useMemo(() => buildAxisTicks(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
    const transitions = useMemo(() => buildTransitions(entries || []), [entries]);

    const uptimePct = useMemo(() => {
        if (!entries || entries.length === 0) return null;
        const online = entries.filter(e => e.online).length;
        return Math.round((online / entries.length) * 1000) / 10;
    }, [entries]);

    const lastCheck = entries && entries.length > 0 ? entries[entries.length - 1] : null;
    const lastStatus = lastCheck ? (lastCheck.online ? "online" : "offline") : null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" style={{ width: 640 }} onClick={e => e.stopPropagation()}>
                <div className="modal-title">{title || target}</div>
                {title && title !== target && <div className="modal-hint mono" style={{ marginTop: -14, marginBottom: 8 }}>{target}</div>}

                {entries && (
                    <div className="history-header">
                        <div className="history-header-left">
                            <span
                                className={lastStatus ? "health-dot" : "health-dot health-dot--none"}
                                style={lastStatus ? { background: lastStatus === "online" ? "var(--accent)" : "var(--danger)" } : undefined}
                            />
                            <span className="history-header-relative">{lastCheck ? formatRelativeTime(lastCheck.at) : "No data yet"}</span>
                        </div>
                        {lastStatus && <span className={`history-header-status history-header-status--${lastStatus}`}>{STATUS_LABEL[lastStatus]}</span>}
                    </div>
                )}

                <div className="history-controls">
                    <div className="history-range-picker">
                        {RANGES.map(r => (
                            <button
                                key={r.label}
                                className={`btn btn--sm ${range.label === r.label ? "btn-primary" : "btn-ghost"}`}
                                onClick={() => setRange(r)}
                            >{r.label}</button>
                        ))}
                    </div>
                    <label className="history-auto-refresh">
                        <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
                        Auto-refresh
                    </label>
                </div>

                {error ? (
                    <div className="card-empty">{error}</div>
                ) : entries === null ? (
                    <div className="loading">Loading...</div>
                ) : (
                    <>
                        <div className="history-timeline">
                            {segments.map((seg, i) => (
                                <div
                                    key={i}
                                    className={`history-segment history-segment--${seg.status}`}
                                    style={{ flexGrow: seg.end - seg.start }}
                                    title={`${STATUS_LABEL[seg.status]} — ${new Date(seg.start).toLocaleString()} to ${new Date(seg.end).toLocaleString()}`}
                                >
                                    <span className="history-segment-label">{STATUS_LABEL[seg.status]}</span>
                                </div>
                            ))}
                        </div>
                        <div className="history-timeline-axis">
                            {ticks.map((t, i) => (
                                <span key={i} className="history-axis-tick" style={{ left: `${(i / AXIS_TICK_COUNT) * 100}%` }}>
                                    {t.isNow ? "Now" : formatAxisTime(t.ms, range.ms)}
                                </span>
                            ))}
                        </div>

                        <div className="history-stats">
                            <div>
                                <span className="history-stat-label">Uptime</span>
                                <span className="history-stat-val">{uptimePct !== null ? `${uptimePct}%` : "—"}</span>
                            </div>
                            <div>
                                <span className="history-stat-label">Checks</span>
                                <span className="history-stat-val">{entries.length}</span>
                            </div>
                        </div>

                        <div className="history-section-label">Activity</div>
                        <div className="history-activity-list">
                            {transitions.length === 0 ? (
                                <div className="history-activity-empty">No status changes in this range</div>
                            ) : transitions.map((t, i) => (
                                <div key={i} className="history-activity-item">
                                    <span className={`history-activity-dot history-activity-dot--${t.online ? "online" : "offline"}`} />
                                    <span className="history-activity-label">{t.online ? "Online" : "Offline"}</span>
                                    <span className="history-activity-time">{formatActivityTime(t.at)}</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                <div className="btn-row flex-end" style={{ marginTop: 20 }}>
                    <button className="btn btn-ghost" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}

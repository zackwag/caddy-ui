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
const GAP_THRESHOLD_MS = 3 * 60 * 1000;
const REFRESH_INTERVAL_MS = 30_000;

// Turns a sparse list of point-in-time checks into contiguous timeline
// segments spanning [rangeStart, rangeEnd], each labeled online/offline/unknown.
function buildSegments(entries, rangeStart, rangeEnd) {
    const points = entries.filter(e => e.at < rangeEnd);
    if (!points.length) return [{ status: "unknown", start: rangeStart, end: rangeEnd }];

    const segments = [];
    let cursor = rangeStart;

    for (let i = 0; i < points.length; i++) {
        const at = Math.max(points[i].at, rangeStart);
        const nextAt = Math.min(i + 1 < points.length ? points[i + 1].at : rangeEnd, rangeEnd);

        if (at > cursor) segments.push({ status: "unknown", start: cursor, end: at });

        if (nextAt - at > GAP_THRESHOLD_MS) {
            const knownEnd = Math.min(at + GAP_THRESHOLD_MS, nextAt);
            segments.push({ status: points[i].online ? "online" : "offline", start: at, end: knownEnd });
            if (nextAt > knownEnd) segments.push({ status: "unknown", start: knownEnd, end: nextAt });
        } else if (nextAt > at) {
            segments.push({ status: points[i].online ? "online" : "offline", start: at, end: nextAt });
        }

        cursor = nextAt;
    }

    if (cursor < rangeEnd) segments.push({ status: "unknown", start: cursor, end: rangeEnd });
    return segments.filter(s => s.end > s.start);
}

function formatAxisTime(ms, rangeMs) {
    const d = new Date(ms);
    return rangeMs > 24 * 60 * 60 * 1000
        ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const STATUS_LABEL = { online: "Online", offline: "Offline", unknown: "No data" };

export default function RouteHistoryModal({ title, upstream, onUnauth, onClose }) {
    const [range, setRange] = useState(RANGES[2]);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [entries, setEntries] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const load = () => {
            const since = Date.now() - range.ms;
            apiFetch(`/health/history?upstream=${encodeURIComponent(upstream)}&since=${since}`, {}, onUnauth)
                .then(data => { if (!cancelled) { setEntries(data.entries); setError(null); } })
                .catch(e => { if (!cancelled) setError(e.message); });
        };
        load();
        if (!autoRefresh) return () => { cancelled = true; };
        const t = setInterval(load, REFRESH_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(t); };
    }, [upstream, range, autoRefresh, onUnauth]);

    const rangeEnd = Date.now();
    const rangeStart = rangeEnd - range.ms;
    const segments = useMemo(() => buildSegments(entries || [], rangeStart, rangeEnd), [entries, rangeStart, rangeEnd]);

    const uptimePct = useMemo(() => {
        if (!entries || entries.length === 0) return null;
        const online = entries.filter(e => e.online).length;
        return Math.round((online / entries.length) * 1000) / 10;
    }, [entries]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" style={{ width: 640 }} onClick={e => e.stopPropagation()}>
                <div className="modal-title">{title || upstream}</div>
                {title && <div className="modal-hint mono" style={{ marginTop: -14, marginBottom: 20 }}>{upstream}</div>}

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
                                />
                            ))}
                        </div>
                        <div className="history-timeline-labels">
                            <span>{formatAxisTime(rangeStart, range.ms)}</span>
                            <span>Now</span>
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
                    </>
                )}

                <div className="btn-row flex-end" style={{ marginTop: 20 }}>
                    <button className="btn btn-ghost" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}

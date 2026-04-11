import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../utils/api.js";

function EditModal({ route, initialNote, isCaddyfileManaged, onSaveRoute, onSaveNote, onClose, onGoToCaddyfile }) {
    const [form, setForm] = useState({
        domain: route.domain || "",
        upstream: route.upstream || "",
        stripPrefix: route.stripPrefix || "",
        _id: route._id || null,
        _originalDomain: route._originalDomain || null,
    });
    const [note, setNote] = useState(initialNote || "");
    const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">Edit Route</div>

                {isCaddyfileManaged ? (
                    <>
                        <div className="caddyfile-notice">
                            This route is defined in the Caddyfile and cannot be edited here.
                        </div>
                        <button className="btn btn-ghost btn--sm" style={{ marginBottom: 20 }} onClick={onGoToCaddyfile}>⌗ Edit in Caddyfile →</button>
                    </>
                ) : (
                    <>
                        <div className="field">
                            <label>Domain</label>
                            <input value={form.domain} onChange={set("domain")} placeholder="app.example.com" disabled={!form._id} />
                        </div>
                        <div className="field">
                            <label>Upstream</label>
                            <input value={form.upstream} onChange={set("upstream")} placeholder="192.168.4.88:8080" />
                        </div>
                        <div className="field">
                            <label>Strip Prefix (optional)</label>
                            <input value={form.stripPrefix} onChange={set("stripPrefix")} placeholder="/api" />
                        </div>
                        <div className="btn-row flex-end" style={{ marginBottom: 20 }}>
                            <button className="btn btn-primary" onClick={() => onSaveRoute(form)} disabled={!form.upstream}>
                                Save Route
                            </button>
                        </div>
                    </>
                )}

                <div className="modal-section-divider" />
                <div className="modal-section-label">Note</div>
                <div className="field">
                    <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Home Assistant, media server..." onKeyDown={e => e.key === 'Enter' && onSaveNote(note)} />
                </div>
                <div className="modal-hint">Leave blank to clear the note.</div>
                <div className="btn-row flex-end">
                    <button className="btn btn-ghost" onClick={onClose}>Close</button>
                    <button className="btn btn-primary" onClick={() => onSaveNote(note)}>Save Note</button>
                </div>
            </div>
        </div>
    );
}

function NewRouteModal({ onSave, onClose }) {
    const [form, setForm] = useState({ domain: "", upstream: "", stripPrefix: "" });
    const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">New Reverse Proxy Route</div>
                <div className="field">
                    <label>Domain</label>
                    <input value={form.domain} onChange={set("domain")} placeholder="app.example.com" autoFocus />
                </div>
                <div className="field">
                    <label>Upstream</label>
                    <input value={form.upstream} onChange={set("upstream")} placeholder="192.168.4.88:8080" />
                </div>
                <div className="field">
                    <label>Strip Prefix (optional)</label>
                    <input value={form.stripPrefix} onChange={set("stripPrefix")} placeholder="/api" />
                </div>
                <div className="btn-row flex-end" style={{ marginTop: 20 }}>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.upstream || !form.domain}>
                        Add Route
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function Routes({ toast, onUnauth }) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [routes, setRoutes] = useState([]);
    const [health, setHealth] = useState({});
    const [uptime, setUptime] = useState({});
    const [certs, setCerts] = useState([]);
    const [notes, setNotes] = useState({});
    const [loading, setLoading] = useState(true);
    const [healthLoading, setHealthLoading] = useState(false);
    const [editModal, setEditModal] = useState(null);
    const [newModal, setNewModal] = useState(false);
    const [sortCol, setSortCol] = useState("domain");
    const [sortDir, setSortDir] = useState("asc");
    const [search, setSearch] = useState(searchParams.get("filter") || "");

    useEffect(() => {
        const f = searchParams.get("filter");
        if (f) setSearch(f);
    }, []);

    const load = () => {
        apiFetch("/routes", {}, onUnauth).then(setRoutes).catch(e => toast.error(e.message)).finally(() => setLoading(false));
        apiFetch("/tls", {}, onUnauth).then(setCerts).catch(() => { });
        apiFetch("/route-notes", {}, onUnauth).then(setNotes).catch(() => { });
    };

    const loadHealth = () => {
        setHealthLoading(true);
        apiFetch("/health", {}, onUnauth)
            .then(results => {
                const map = {};
                for (const r of results) map[r.upstream] = r.online;
                setHealth(map);
            })
            .catch(() => { })
            .finally(() => setHealthLoading(false));
        apiFetch("/health/uptime", {}, onUnauth).then(setUptime).catch(() => { });
    };

    useEffect(() => {
        load(); loadHealth();
        const t = setInterval(loadHealth, 30000);
        return () => clearInterval(t);
    }, []);

    const addRoute = async (form) => {
        try {
            await apiFetch("/routes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }, onUnauth);
            toast.success(`Route for ${form.domain} added`);
            setNewModal(false); load(); loadHealth();
        } catch (e) { toast.error(e.message); }
    };

    const editRoute = async (form) => {
        try {
            await apiFetch(`/routes/${form._id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: form.domain, upstream: form.upstream, stripPrefix: form.stripPrefix }) }, onUnauth);
            toast.success("Route updated");
            setEditModal(null); load(); loadHealth();
        } catch (e) { toast.error(e.message); }
    };

    const deleteRoute = async (id) => {
        if (!confirm("Delete this route?")) return;
        try {
            await apiFetch(`/routes/${id}`, { method: "DELETE" }, onUnauth);
            toast.success("Route removed"); load(); loadHealth();
        } catch (e) { toast.error(e.message); }
    };

    const saveNote = async (domain, note) => {
        try {
            await apiFetch(`/route-notes/${encodeURIComponent(domain)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) }, onUnauth);
            setNotes(n => { const u = { ...n }; if (note.trim()) u[domain] = note.trim(); else delete u[domain]; return u; });
            toast.success(note.trim() ? "Note saved" : "Note cleared");
            setEditModal(null);
        } catch (e) { toast.error(e.message); }
    };

    const getHost = (route) => route.match?.find(m => m.host)?.host?.join(", ") || "—";

    const getUpstream = (route) => {
        const dials = [];
        function walk(handles) {
            for (const h of handles || []) {
                if (h.handler === 'reverse_proxy' && h.upstreams) {
                    for (const u of h.upstreams) if (u.dial) dials.push(u.dial);
                }
                if (h.routes) {
                    for (const r of h.routes) walk(r.handle);
                }
            }
        }
        walk(route.handle);
        return dials.join(", ") || "—";
    };

    const getStripPrefix = (route) => (route.match?.find(m => m.path)?.path?.[0] || "").replace("/*", "");

    const openEdit = (route) => {
        const domain = getHost(route);
        const hasId = !!route["@id"];
        setEditModal({
            route: {
                domain,
                upstream: getUpstream(route),
                stripPrefix: getStripPrefix(route),
                _id: route["@id"] || null,
                _originalDomain: domain,
            },
            domain,
            isCaddyfileManaged: !hasId,
        });
    };

    const getDomainScheme = (domain) => {
        if (domain.startsWith("http://")) return "http";
        return certs.some(c => c.domain === domain && c.status !== "orphaned") ? "https" : "http";
    };

    const domainLink = (domain) => {
        if (domain === "—") return null;
        const clean = domain.replace(/^https?:\/\//, "");
        return `${getDomainScheme(clean)}://${clean}`;
    };

    const upstreamLink = (upstream) => upstream === "—" ? null : `http://${upstream}`;

    const getHealthDot = (route) => {
        const upstream = getUpstream(route);
        if (upstream === "—") return <span className="health-dot health-dot--none" title="No upstream" />;
        const upstreams = upstream.split(", ");
        const allOnline = upstreams.every(u => health[u] === true);
        const anyOnline = upstreams.some(u => health[u] === true);
        const checked = upstreams.some(u => u in health);
        if (!checked) return <span className="health-dot health-dot--pending" title="Checking..." />;
        const color = allOnline ? "var(--accent)" : anyOnline ? "var(--warn)" : "var(--danger)";
        const shadow = allOnline ? "0 0 4px var(--accent)" : anyOnline ? "0 0 4px var(--warn)" : "0 0 4px var(--danger)";
        const stats = uptime[upstreams[0]];
        const uptimeLabel = stats && stats.total > 1 ? `${stats.pct}%` : null;
        return (
            <div className="health-dot-wrap">
                <span className="health-dot" style={{ background: color, boxShadow: shadow }} title={allOnline ? "Online" : anyOnline ? "Partial" : "Offline"} />
                {uptimeLabel && <span className="uptime-label">{uptimeLabel}</span>}
            </div>
        );
    };

    const handleSort = (col) => {
        if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
        else { setSortCol(col); setSortDir("asc"); }
    };

    const filtered = routes.filter(r => {
        if (!search) return true;
        const q = search.toLowerCase();
        return getHost(r).toLowerCase().includes(q) || getUpstream(r).toLowerCase().includes(q) || (notes[getHost(r)] || "").toLowerCase().includes(q) || (r._server || "").toLowerCase().includes(q);
    });

    const sorted = [...filtered].sort((a, b) => {
        let valA, valB;
        if (sortCol === "domain") { valA = getHost(a); valB = getHost(b); }
        else if (sortCol === "upstream") { valA = getUpstream(a); valB = getUpstream(b); }
        else { valA = a._server || ""; valB = b._server || ""; }
        return sortDir === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });

    const SortIcon = ({ col }) => {
        if (sortCol !== col) return <span className="sort-icon">↕</span>;
        return <span className="sort-icon--active">{sortDir === "asc" ? "↑" : "↓"}</span>;
    };

    if (loading) return <div className="loading">Loading routes...</div>;

    return (
        <>
            <div className="gap-16">
                <div className="flex-between">
                    <div className="flex-center" style={{ gap: 12 }}>
                        <input className="search-input" placeholder="Filter by domain, upstream, note, or server..." value={search} onChange={e => setSearch(e.target.value)} />
                        <span className="section-label">
                            {healthLoading ? "Checking..." : `${Object.values(health).filter(Boolean).length}/${Object.keys(health).length} online`}
                        </span>
                    </div>
                    <div className="btn-row">
                        <button className="btn btn-ghost btn--sm" onClick={loadHealth} disabled={healthLoading}>↺ Refresh</button>
                        <button className="btn btn-primary" onClick={() => setNewModal(true)}>+ Add Route</button>
                    </div>
                </div>
                <div className="card card-flush">
                    {sorted.length === 0 ? (
                        <div className="card-empty">
                            {search ? `No routes matching "${search}"` : "No routes configured"}
                        </div>
                    ) : (
                        <div className="table-wrap">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th className="th-sortable" onClick={() => handleSort("domain")}>Domain <SortIcon col="domain" /></th>
                                        <th className="th-sortable" onClick={() => handleSort("upstream")}>Upstream <SortIcon col="upstream" /></th>
                                        <th className="th-sortable" onClick={() => handleSort("server")}>Server <SortIcon col="server" /></th>
                                        <th>ID</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.map((r, i) => {
                                        const domain = getHost(r);
                                        const upstream = getUpstream(r);
                                        const dLink = domainLink(domain);
                                        const uLink = upstreamLink(upstream);
                                        const hasId = !!r["@id"];
                                        const note = notes[domain];
                                        return (
                                            <tr key={r["@id"] || i}>
                                                <td>
                                                    <div className="route-domain-cell">
                                                        {getHealthDot(r)}
                                                        <div>
                                                            {dLink ? <a href={dLink} target="_blank" rel="noopener noreferrer" className="mono route-link">{domain}</a> : <span className="mono">{domain}</span>}
                                                            {note && <div className="route-note">{note}</div>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    {uLink ? <a href={uLink} target="_blank" rel="noopener noreferrer" className="mono route-link upstream">{upstream}</a> : <span className="mono" style={{ color: "var(--accent2)" }}>{upstream}</span>}
                                                </td>
                                                <td
                                                    className="mono cell-muted"
                                                    style={{ cursor: r._server ? "pointer" : "default" }}
                                                    onClick={() => r._server && setSearch(r._server)}
                                                    title={r._server ? `Filter by ${r._server}` : undefined}
                                                    onMouseEnter={e => { if (r._server) e.target.style.color = "var(--accent)"; }}
                                                    onMouseLeave={e => { if (r._server) e.target.style.color = "var(--muted)"; }}
                                                >{r._server || "—"}</td>
                                                <td className="mono cell-muted">{r["@id"] || "—"}</td>
                                                <td className="col-actions">
                                                    <div className="btn-row flex-end">
                                                        <button
                                                            className="btn btn-ghost btn--icon"
                                                            style={{ color: note ? "var(--accent2)" : "var(--muted)" }}
                                                            onClick={() => openEdit(r)}
                                                            title="Edit route"
                                                        >✎</button>
                                                        {hasId && <button className="btn btn-danger btn--icon" onClick={() => deleteRoute(r["@id"])}>✕</button>}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
            {editModal && (
                <EditModal
                    route={editModal.route}
                    initialNote={notes[editModal.domain] || ""}
                    isCaddyfileManaged={editModal.isCaddyfileManaged}
                    onSaveRoute={editRoute}
                    onSaveNote={(note) => saveNote(editModal.domain, note)}
                    onGoToCaddyfile={() => { setEditModal(null); navigate("/caddyfile"); }}
                    onClose={() => setEditModal(null)}
                />
            )}
            {newModal && <NewRouteModal onSave={addRoute} onClose={() => setNewModal(false)} />}
        </>
    );
}

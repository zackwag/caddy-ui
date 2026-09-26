import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "../utils/api.js";

function MiniCodeMirror({ value, onChange, theme }) {
    const containerRef = useRef(null);
    const viewRef = useRef(null);
    const onChangeRef = useRef(onChange);

    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

    useEffect(() => {
        if (!containerRef.current) return;
        let view;

        async function init() {
            const { EditorView, keymap, lineNumbers, highlightActiveLineGutter, drawSelection, highlightSpecialChars } = await import("@codemirror/view");
            const { EditorState } = await import("@codemirror/state");
            const { defaultKeymap, historyKeymap, history } = await import("@codemirror/commands");
            const { StreamLanguage, syntaxHighlighting, indentOnInput, bracketMatching } = await import("@codemirror/language");
            const { classHighlighter } = await import("@lezer/highlight");
            const { caddyfile } = await import("../lib/caddyfileMode.js");

            const isDark = theme === 'dark';

            const editorTheme = EditorView.theme({
                "&": { background: isDark ? "#0a0c0f" : "#f0ebe4", color: isDark ? "#c9d1e0" : "#2c2825", fontSize: "13px", fontFamily: "'IBM Plex Mono', monospace" },
                ".cm-content": { padding: "12px", caretColor: "var(--accent)", lineHeight: "1.7" },
                ".cm-gutters": { background: isDark ? "#0d0f12" : "#e8e2db", color: isDark ? "#586275" : "#8a7f75", border: "none", borderRight: `1px solid ${isDark ? "#1e2329" : "#d0c8c0"}`, paddingRight: "8px" },
                ".cm-activeLineGutter": { background: isDark ? "rgba(0,229,160,0.05)" : "rgba(0,149,107,0.05)" },
                ".cm-activeLine": { background: isDark ? "rgba(0,229,160,0.03)" : "rgba(0,149,107,0.03)" },
                ".cm-cursor": { borderLeftColor: "var(--accent)" },
                ".cm-selectionBackground, ::selection": { background: isDark ? "rgba(0,153,255,0.2) !important" : "rgba(0,119,204,0.15) !important" },
                ".cm-line": { padding: "0 4px" },
                ".tok-keyword": { color: isDark ? "#00e5a0" : "#00956b" },
                ".tok-string": { color: isDark ? "#ffb830" : "#b36000" },
                ".tok-comment": { color: isDark ? "#586275" : "#8a7f75", fontStyle: "italic" },
                ".tok-number": { color: isDark ? "#0099ff" : "#0077cc" },
                ".tok-operator": { color: isDark ? "#c9d1e0" : "#2c2825" },
                ".tok-variableName": { color: isDark ? "#ff4d6a" : "#cc2233" },
                ".tok-typeName": { color: isDark ? "#00e5a0" : "#00956b" },
                ".tok-atom": { color: isDark ? "#ffb830" : "#b36000" },
                ".tok-propertyName": { color: isDark ? "#0099ff" : "#0077cc" },
                ".tok-variableName2": { color: isDark ? "#b388ff" : "#7c4dff" },
                "& .cm-scroller": { overflow: "auto" },
            }, { dark: isDark });

            const startState = EditorState.create({
                doc: value,
                extensions: [
                    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
                    history(), drawSelection(), indentOnInput(), bracketMatching(),
                    syntaxHighlighting(classHighlighter),
                    StreamLanguage.define(caddyfile), editorTheme,
                    keymap.of([...defaultKeymap, ...historyKeymap]),
                    EditorView.updateListener.of(update => {
                        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
                    }),
                    EditorView.lineWrapping,
                ],
            });

            view = new EditorView({ state: startState, parent: containerRef.current });
            viewRef.current = view;
        }

        init();
        return () => { view?.destroy(); viewRef.current = null; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [theme]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }, [value]);

    return <div ref={containerRef} className="modal-editor-wrap" style={{ minHeight: 180, background: theme === 'dark' ? "#0a0c0f" : "#f0ebe4" }} />;
}

function EditModal({ route, initialNote, isCaddyfileManaged, siteBlockFailed, initialContent, titleNeedsMigration, onSave, onDelete, onClose, theme }) {
    const [form, setForm] = useState({
        domain: route.domain || "",
        upstream: route.upstream || "",
        stripPrefix: route.stripPrefix || "",
        _id: route._id || null,
        _originalDomain: route._originalDomain || null,
    });
    const [title, setTitle] = useState(initialNote || "");
    const [content, setContent] = useState(initialContent || "");
    const [saving, setSaving] = useState(false);
    const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

    const canSave = isCaddyfileManaged ? content.trim().length > 0 : !!form.upstream;

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave({ form, title, content });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={isCaddyfileManaged ? { width: 560 } : undefined}>
                <div className="modal-title">Edit Route</div>

                <div className="modal-section-label">Title</div>
                <div className="field">
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Home Assistant, media server..." onKeyDown={e => { if (e.key === 'Enter' && canSave) handleSave(); }} />
                </div>
                <div className="modal-hint">{titleNeedsMigration ? "Save to store this title as a comment in your Caddyfile." : "Leave blank to clear the title."}</div>

                {isCaddyfileManaged && siteBlockFailed ? (
                    <div className="modal-hint" style={{ marginTop: 12, padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4 }}>
                        This route is defined in your Caddyfile but couldn't be loaded for inline editing. Use the <strong>Caddyfile</strong> tab to edit it directly.
                    </div>
                ) : isCaddyfileManaged ? (
                    <>
                        <div className="modal-section-label">Caddyfile</div>
                        <div className="editor-wrap" style={{ marginBottom: 16 }}>
                            <MiniCodeMirror value={content} onChange={setContent} theme={theme} />
                        </div>
                    </>
                ) : (
                    <>
                        <div className="modal-section-divider" />
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
                    </>
                )}

                <div className="btn-row" style={{ justifyContent: "space-between" }}>
                    {isCaddyfileManaged && !siteBlockFailed ? (
                        <button className="btn btn-danger" onClick={onDelete}>Delete</button>
                    ) : <span />}
                    <div className="btn-row">
                        <button className="btn btn-ghost" onClick={onClose}>Close</button>
                        <button className="btn btn-primary" onClick={handleSave} disabled={siteBlockFailed ? saving : (!canSave || saving)}>{saving ? "Saving..." : "Save"}</button>
                    </div>
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

export default function Routes({ toast, onUnauth, confirm, theme }) {
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
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only read the filter param once on initial load, not on every URL change
    }, []);

    const load = useCallback(() => {
        apiFetch("/routes", {}, onUnauth).then(setRoutes).catch(e => toast.error(e.message)).finally(() => setLoading(false));
        apiFetch("/tls", {}, onUnauth).then(setCerts).catch(() => { });
        apiFetch("/route-notes", {}, onUnauth).then(setNotes).catch(() => { });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- toast isn't stable across renders
    }, [onUnauth]);

    const loadHealth = useCallback(() => {
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
    }, [onUnauth]);

    useEffect(() => {
        load(); loadHealth();
        const t = setInterval(loadHealth, 30000);
        return () => clearInterval(t);
    }, [load, loadHealth]);

    const addRoute = async (form) => {
        try {
            await apiFetch("/routes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }, onUnauth);
            toast.success(`Route for ${form.domain} added`);
            setNewModal(false); load(); loadHealth();
        } catch (e) { toast.error(e.message); }
    };

    const deleteCaddyfileBlock = async (domain) => {
        if (!await confirm("Delete this route? This will remove the site block from the Caddyfile.", { confirmLabel: "Delete", danger: true })) return;
        try {
            await apiFetch(`/routes/caddyfile/${encodeURIComponent(domain)}`, { method: "DELETE" }, onUnauth);
            if (notes[domain]) {
                await apiFetch(`/route-notes/${encodeURIComponent(domain)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "" }) }, onUnauth).catch(() => {});
                setNotes(n => { const u = { ...n }; delete u[domain]; return u; });
            }
            toast.success("Route removed");
            setEditModal(null); load(); loadHealth();
        } catch (e) { toast.error(e.message); }
    };

    const handleEditSave = async ({ form, title, content }) => {
        const domain = editModal.domain;
        const usesCaddyfileTitles = editModal.caddyfileTitle !== null;
        try {
            if (editModal.isCaddyfileManaged && !editModal.siteBlockFailed) {
                await apiFetch(`/routes/caddyfile/${encodeURIComponent(domain)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, title }) }, onUnauth);
                toast.success("Caddyfile updated");
            } else if (editModal.siteBlockFailed) {
                toast.success("Title saved");
            } else {
                await apiFetch(`/routes/${form._id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: form.domain, upstream: form.upstream, stripPrefix: form.stripPrefix }) }, onUnauth);
                toast.success("Route updated");
            }
            if (!editModal.isCaddyfileManaged || !usesCaddyfileTitles || editModal.siteBlockFailed) {
                await apiFetch(`/route-notes/${encodeURIComponent(domain)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: title }) }, onUnauth);
            }
            setNotes(n => { const u = { ...n }; if (title.trim()) u[domain] = title.trim(); else delete u[domain]; return u; });
            setEditModal(null); load(); loadHealth();
        } catch (e) { toast.error(e.message); }
    };

    const deleteRoute = async (id, domain) => {
        if (!await confirm("Delete this route?", { confirmLabel: "Delete", danger: true })) return;
        try {
            await apiFetch(`/routes/${id}`, { method: "DELETE" }, onUnauth);
            if (domain && notes[domain]) {
                await apiFetch(`/route-notes/${encodeURIComponent(domain)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "" }) }, onUnauth).catch(() => {});
                setNotes(n => { const u = { ...n }; delete u[domain]; return u; });
            }
            toast.success("Route removed"); load(); loadHealth();
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

    const openEdit = async (route) => {
        const domain = getHost(route);
        const hasId = !!route["@id"];
        const isCaddyfileManaged = !hasId;

        let content = "";
        let caddyfileTitle = null;
        let siteBlockFailed = false;
        if (isCaddyfileManaged) {
            try {
                const result = await apiFetch(`/routes/caddyfile/${encodeURIComponent(domain)}`, {}, onUnauth);
                content = result.content || "";
                if (result.title !== undefined) caddyfileTitle = result.title;
            } catch {
                siteBlockFailed = true;
            }
        }

        setEditModal({
            route: {
                domain,
                upstream: getUpstream(route),
                stripPrefix: getStripPrefix(route),
                _id: route["@id"] || null,
                _originalDomain: domain,
            },
            domain,
            isCaddyfileManaged,
            content,
            caddyfileTitle,
            siteBlockFailed,
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

    const getUptimePct = (route) => {
        const upstream = getUpstream(route);
        if (upstream === "—") return null;
        const upstreams = upstream.split(", ");
        const stats = uptime[upstreams[0]];
        return stats && stats.total > 1 ? stats.pct : null;
    };

    const getHealthDot = (route) => {
        const upstream = getUpstream(route);
        const pct = getUptimePct(route);
        const pctText = pct !== null ? `${pct}%` : "N/A";
        if (upstream === "—") {
            return <span className="health-dot health-dot--none" title="No upstream"><span className="sr-only">No upstream, {pctText}</span></span>;
        }
        const upstreams = upstream.split(", ");
        const allOnline = upstreams.every(u => health[u] === true);
        const anyOnline = upstreams.some(u => health[u] === true);
        const checked = upstreams.some(u => u in health);
        if (!checked) {
            return <span className="health-dot health-dot--pending" title="Checking..."><span className="sr-only">Checking, {pctText}</span></span>;
        }
        const color = allOnline ? "var(--accent)" : anyOnline ? "var(--warn)" : "var(--danger)";
        const shadow = allOnline ? "0 0 4px var(--accent)" : anyOnline ? "0 0 4px var(--warn)" : "0 0 4px var(--danger)";
        const status = allOnline ? "Online" : anyOnline ? "Partial" : "Offline";
        const title = pct !== null ? `${status} — ${pctText} uptime` : status;
        return (
            <span className="health-dot" style={{ background: color, boxShadow: shadow }} title={title}>
                <span className="sr-only">{status}, {pctText}</span>
            </span>
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
        else if (sortCol === "title") { valA = notes[getHost(a)] || ""; valB = notes[getHost(b)] || ""; }
        else if (sortCol === "upstream") { valA = getUpstream(a); valB = getUpstream(b); }
        else if (sortCol === "uptime") {
            valA = getUptimePct(a) ?? 101;
            valB = getUptimePct(b) ?? 101;
            const diff = sortDir === "asc" ? valA - valB : valB - valA;
            return diff !== 0 ? diff : getHost(a).localeCompare(getHost(b));
        }
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
                <div className="flex-between routes-toolbar">
                    <div className="flex-center" style={{ gap: 12 }}>
                        <div className="search-wrap">
                            <input className="search-input search-input--clearable" placeholder="Filter by domain, upstream, note, or server..." value={search} onChange={e => setSearch(e.target.value)} />
                            {search && <button className="search-clear" onClick={() => setSearch("")} title="Clear filter">✕</button>}
                        </div>
                        <span className="section-label">
                            {healthLoading ? "Checking..." : `${Object.values(health).filter(Boolean).length}/${Object.keys(health).length} routes online`}
                        </span>
                    </div>
                    <div className="btn-row routes-toolbar-actions">
                        <button className="btn btn-ghost" onClick={loadHealth} disabled={healthLoading}>↺ Refresh</button>
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
                                        <th className="th-sortable col-status" onClick={() => handleSort("uptime")}>Status <SortIcon col="uptime" /></th>
                                        <th className="th-sortable" onClick={() => handleSort("domain")}>Domain <SortIcon col="domain" /></th>
                                        <th className="th-sortable col-title" onClick={() => handleSort("title")}>Title <SortIcon col="title" /></th>
                                        <th className="th-sortable" onClick={() => handleSort("upstream")}>Upstream <SortIcon col="upstream" /></th>
                                        <th className="th-sortable" onClick={() => handleSort("server")}>Server <SortIcon col="server" /></th>
                                        <th>ID</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.map((r, i) => {
                                        const domain = getHost(r);
                                        const hosts = domain === "—" ? [] : domain.split(", ");
                                        const upstream = getUpstream(r);
                                        const uLink = upstreamLink(upstream);
                                        const hasId = !!r["@id"];
                                        const note = notes[domain];
                                        return (
                                            <tr key={r["@id"] || i}>
                                                <td className="col-status">{getHealthDot(r)}</td>
                                                <td>
                                                    <div className="route-domain-cell">
                                                        <div>
                                                            {hosts.length > 0 ? hosts.map((h, hi) => {
                                                                const hLink = domainLink(h);
                                                                return (
                                                                    <span key={h}>
                                                                        {hi > 0 && <span className="route-domain-sep">, </span>}
                                                                        {hLink
                                                                            ? <a href={hLink} target="_blank" rel="noopener noreferrer" className="mono route-link">{h}</a>
                                                                            : <span className="mono">{h}</span>}
                                                                    </span>
                                                                );
                                                            }) : <span className="mono">{domain}</span>}
                                                            {note && <div className="route-note route-note--mobile">{note}</div>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="col-title cell-muted">{note || "—"}</td>
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
                                                        {hasId && <button className="btn btn-danger btn--icon" onClick={() => deleteRoute(r["@id"], domain)}>✕</button>}
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
                    initialNote={editModal.caddyfileTitle || notes[editModal.domain] || ""}
                    isCaddyfileManaged={editModal.isCaddyfileManaged}
                    siteBlockFailed={editModal.siteBlockFailed}
                    initialContent={editModal.content || ""}
                    titleNeedsMigration={editModal.isCaddyfileManaged && editModal.caddyfileTitle !== null && !editModal.caddyfileTitle && !!notes[editModal.domain]}
                    onSave={handleEditSave}
                    onDelete={() => deleteCaddyfileBlock(editModal.domain)}
                    onClose={() => setEditModal(null)}
                    theme={theme}
                />
            )}
            {newModal && <NewRouteModal onSave={addRoute} onClose={() => setNewModal(false)} />}
        </>
    );
}

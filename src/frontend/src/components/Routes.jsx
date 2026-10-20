import { notifyConfigurationSave } from '../utils/caddyfileHistory.js';
import { UtilityIcon } from "./Icons.jsx";
import { localizeError } from "../utils/errorMessages.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { useClickOutside } from "../hooks/useClickOutside.js";
import RouteHistoryModal from "./RouteHistoryModal.jsx";
import { apiFetch, getInstanceId } from "../utils/api.js";
import { formatPercent } from "../utils/format.js";
import { stateNotificationKey } from "../utils/notificationCenter.js";
import { getRouteCheckHost, getRouteHost, getRouteTitle, getRouteUpstreams } from "../utils/routes.js";

// eslint-disable-next-line i18next/no-literal-string -- Example hostname
const DOMAIN_PLACEHOLDER = "app.example.com";

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

            // Colors read from the CSS theme variables (see styles.js) rather than
            // being hardcoded per-theme here, so a new theme needs no changes in
            // this file -- only a new entry in the THEMES registry.
            const editorTheme = EditorView.theme({
                "&": { background: "var(--editor-bg)", color: "var(--text)", fontSize: "13px", fontFamily: "'IBM Plex Mono', monospace" },
                ".cm-content": { padding: "12px", caretColor: "var(--accent)", lineHeight: "1.7" },
                ".cm-gutters": { background: "var(--editor-gutter)", color: "var(--muted)", border: "none", borderRight: "1px solid var(--editor-border)", paddingRight: "8px" },
                ".cm-activeLineGutter": { background: "var(--editor-active-gutter)" },
                ".cm-activeLine": { background: "var(--editor-active-line)" },
                ".cm-cursor": { borderLeftColor: "var(--accent)" },
                ".cm-selectionBackground, ::selection": { background: "var(--editor-selection) !important" },
                ".cm-line": { padding: "0 4px" },
                ".tok-keyword": { color: "var(--accent)" },
                ".tok-string": { color: "var(--warn)" },
                ".tok-comment": { color: "var(--muted)", fontStyle: "italic" },
                ".tok-number": { color: "var(--accent2)" },
                ".tok-operator": { color: "var(--text)" },
                ".tok-variableName": { color: "var(--danger)" },
                ".tok-typeName": { color: "var(--accent)" },
                ".tok-atom": { color: "var(--warn)" },
                ".tok-propertyName": { color: "var(--accent2)" },
                ".tok-variableName2": { color: "var(--accent3)" },
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

    return <div ref={containerRef} className="modal-editor-wrap" style={{ minHeight: 180, background: "var(--editor-bg)" }} />;
}

function EditModal({ route, initialNote, isCaddyfileManaged, siteBlockFailed, initialContent, titleNeedsMigration, inMaintenance, onSave, onDelete, onClose, theme }) {
    const { t } = useTranslation();
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
                <div className="modal-title">{t("routes.editRoute")}</div>

                <div className="modal-section-label">{t("routes.title")}</div>
                <div className="field">
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("routes.titlePlaceholder")} onKeyDown={e => { if (e.key === 'Enter' && canSave) handleSave(); }} />
                </div>
                <div className="modal-hint">{titleNeedsMigration ? t("routes.titleMigrationHint") : t("routes.titleClearHint")}</div>

                {inMaintenance && (
                    <div className="modal-hint" style={{ marginTop: 12, padding: "12px 14px", background: "color-mix(in srgb, var(--accent3) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--accent3) 30%, transparent)", borderRadius: 4, color: "var(--accent3)" }}>
                        <UtilityIcon name="wrench" /> {t("routes.maintenanceEditHint")}
                    </div>
                )}

                {isCaddyfileManaged && siteBlockFailed ? (
                    <div className="modal-hint" style={{ marginTop: 12, padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4 }}>
                        <Trans i18nKey="routes.caddyfileLoadFailed" components={{ strong: <strong /> }} />
                    </div>
                ) : isCaddyfileManaged && !inMaintenance ? (
                    <>
                        <div className="modal-section-label">{t("routes.caddyfile")}</div>
                        <div className="editor-wrap" style={{ marginBottom: 16 }}>
                            <MiniCodeMirror value={content} onChange={setContent} theme={theme} />
                        </div>
                    </>
                ) : isCaddyfileManaged && inMaintenance ? (
                    null
                ) : (
                    <>
                        <div className="modal-section-divider" />
                        <div className="field">
                            <label>{t("routes.domain")}</label>
                            <input dir="ltr" value={form.domain} onChange={set("domain")} placeholder={DOMAIN_PLACEHOLDER} disabled={!form._id} />
                        </div>
                        <div className="field">
                            <label>{t("routes.upstream")}</label>
                            <input dir="ltr" value={form.upstream} onChange={set("upstream")} placeholder="192.168.4.88:8080" />
                        </div>
                        <div className="field">
                            <label>{t("routes.stripPrefixOptional")}</label>
                            <input dir="ltr" value={form.stripPrefix} onChange={set("stripPrefix")} placeholder="/api" />
                        </div>
                    </>
                )}

                <div className="btn-row" style={{ justifyContent: "space-between" }}>
                    {isCaddyfileManaged && !siteBlockFailed ? (
                        <button className="btn btn-danger" onClick={onDelete}>{t("common.delete")}</button>
                    ) : <span />}
                    <div className="btn-row">
                        <button className="btn btn-ghost" onClick={onClose}>{t("common.close")}</button>
                        <button className="btn btn-primary" onClick={handleSave} disabled={siteBlockFailed ? saving : (!canSave || saving)}>{saving ? t("common.saving") : t("common.save")}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function NewRouteModal({ onSave, onClose }) {
    const { t } = useTranslation();
    const [form, setForm] = useState({ domain: "", upstream: "", stripPrefix: "" });
    const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">{t("routes.newRoute")}</div>
                <div className="field">
                    <label>{t("routes.domain")}</label>
                    <input dir="ltr" value={form.domain} onChange={set("domain")} placeholder={DOMAIN_PLACEHOLDER} autoFocus />
                </div>
                <div className="field">
                    <label>{t("routes.upstream")}</label>
                    <input dir="ltr" value={form.upstream} onChange={set("upstream")} placeholder="192.168.4.88:8080" />
                </div>
                <div className="field">
                    <label>{t("routes.stripPrefixOptional")}</label>
                    <input dir="ltr" value={form.stripPrefix} onChange={set("stripPrefix")} placeholder="/api" />
                </div>
                <div className="btn-row flex-end" style={{ marginTop: 20 }}>
                    <button className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
                    <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.upstream || !form.domain}>
                        {t("routes.addRoute")}
                    </button>
                </div>
            </div>
        </div>
    );
}

const TOGGLEABLE_COLUMNS = [
    { key: "status", labelKey: "routes.status" },
    { key: "title", labelKey: "routes.title" },
    { key: "upstream", labelKey: "routes.upstream" },
    { key: "server", labelKey: "routes.server" },
    { key: "id", labelKey: "routes.id" },
];

const STATUS_STYLE = {
    online: { labelKey: "routes.online", color: "var(--accent)" },
    partial: { labelKey: "routes.partial", color: "var(--warn)" },
    offline: { labelKey: "routes.offline", color: "var(--danger)" },
    maintenance: { labelKey: "routes.maintenance", color: "var(--accent3)" },
};

export default function Routes({ toast, onUnauth, confirm, theme, routeColumns, onRouteColumnsChange, routeChecks, routeCheckExcludes }) {
    const { t } = useTranslation();
    const [searchParams] = useSearchParams();
    const [routes, setRoutes] = useState([]);
    const [health, setHealth] = useState({});
    const [uptime, setUptime] = useState({});
    const [routeUptime, setRouteUptime] = useState({});
    const [certs, setCerts] = useState([]);
    const [notes, setNotes] = useState({});
    // Set while notes couldn't be loaded, so a blank title isn't saved over a real note
    const [notesError, setNotesError] = useState(null);
    // Dashboard labels by Server ID, e.g. { srv0: "HTTPS Sites" }
    const [serverLabels, setServerLabels] = useState({});
    const [maintenance, setMaintenance] = useState({});
    const [loading, setLoading] = useState(true);
    // Kept until a load succeeds, so an outage isn't shown as "no routes"
    const [loadError, setLoadError] = useState(null);
    const [healthLoading, setHealthLoading] = useState(false);
    const [editModal, setEditModal] = useState(null);
    const [newModal, setNewModal] = useState(false);
    const [historyModal, setHistoryModal] = useState(null);
    const [sortCol, setSortCol] = useState("domain");
    const [sortDir, setSortDir] = useState("asc");
    const [search, setSearch] = useState(searchParams.get("filter") || "");
    const columns = routeColumns;
    const [colMenuOpen, setColMenuOpen] = useState(false);
    const colMenuRef = useRef(null);

    useClickOutside(colMenuRef, () => setColMenuOpen(false), colMenuOpen);

    const toggleColumn = (key) => onRouteColumnsChange({ ...columns, [key]: !columns[key] });
    const columnsHidden = TOGGLEABLE_COLUMNS.some(c => !columns[c.key]);

    useEffect(() => {
        const f = searchParams.get("filter");
        if (f) setSearch(f);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only read the filter param once on initial load, not on every URL change
    }, []);

    const load = useCallback(() => {
        const key = stateNotificationKey('routes.load', getInstanceId());
        apiFetch("/routes", {}, onUnauth)
            .then(data => { toast.recover(key); setLoadError(null); setRoutes(data); })
            .catch(e => { setLoadError(e); toast.error(localizeError(e, t), e, { mode: 'state', key }); })
            .finally(() => setLoading(false));
        apiFetch("/tls", {}, onUnauth).then(setCerts).catch(() => { });
        const notesKey = stateNotificationKey('routeNotes.load', getInstanceId());
        apiFetch("/route-notes", {}, onUnauth)
            .then(data => { toast.recover(notesKey); setNotesError(null); setNotes(data); })
            .catch(e => { setNotesError(e); toast.error(localizeError(e, t), e, { mode: 'state', key: notesKey }); });
        apiFetch("/server-names", {}, onUnauth).then(setServerLabels).catch(() => { });
        apiFetch("/routes/maintenance", {}, onUnauth).then(setMaintenance).catch(() => { });
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
        if (routeChecks) apiFetch("/health/uptime?kind=route", {}, onUnauth).then(setRouteUptime).catch(() => { });
    }, [onUnauth, routeChecks]);

    useEffect(() => {
        load(); loadHealth();
        const t = setInterval(loadHealth, 30000);
        return () => clearInterval(t);
    }, [load, loadHealth]);

    const addRoute = async (form) => {
        try {
            const result = await apiFetch("/routes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }, onUnauth);
            notifyConfigurationSave(toast, t, result, t("routes.added", { domain: form.domain }));
            setNewModal(false); load(); loadHealth();
        } catch (e) { toast.error(localizeError(e, t), e); }
    };

    const deleteCaddyfileBlock = async (domain) => {
        if (!await confirm(t("routes.deleteCaddyfileConfirm"), { confirmLabel: t("common.delete"), danger: true })) return;
        try {
            const result = await apiFetch(`/routes/caddyfile/${encodeURIComponent(domain)}`, { method: "DELETE" }, onUnauth);
            if (notes[domain]) {
                await apiFetch(`/route-notes/${encodeURIComponent(domain)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "" }) }, onUnauth).catch(() => {});
                setNotes(n => { const u = { ...n }; delete u[domain]; return u; });
            }
            notifyConfigurationSave(toast, t, result, t("routes.removed"));
            setEditModal(null); load(); loadHealth();
        } catch (e) { toast.error(localizeError(e, t), e); }
    };

    const handleEditSave = async ({ form, title, content }) => {
        const domain = editModal.domain;
        const usesCaddyfileTitles = editModal.caddyfileTitle !== null;
        try {
            if (editModal.isCaddyfileManaged && !editModal.siteBlockFailed) {
                const result = await apiFetch(`/routes/caddyfile/${encodeURIComponent(domain)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, title }) }, onUnauth);
                notifyConfigurationSave(toast, t, result, t("routes.caddyfileUpdated"));
            } else if (editModal.siteBlockFailed) {
                toast.success(t("routes.titleSaved"));
            } else {
                const result = await apiFetch(`/routes/${form._id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: form.domain, upstream: form.upstream, stripPrefix: form.stripPrefix }) }, onUnauth);
                notifyConfigurationSave(toast, t, result, t("routes.updated"));
            }
            // Without loaded notes the title field starts blank, so blank can't mean "clear the note"
            const saveNote = !(notesError && !title.trim());
            if (saveNote && (!editModal.isCaddyfileManaged || !usesCaddyfileTitles || editModal.siteBlockFailed)) {
                await apiFetch(`/route-notes/${encodeURIComponent(domain)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: title }) }, onUnauth);
            }
            if (saveNote) setNotes(n => { const u = { ...n }; if (title.trim()) u[domain] = title.trim(); else delete u[domain]; return u; });
            setEditModal(null); load(); loadHealth();
        } catch (e) { toast.error(localizeError(e, t), e); }
    };

    const deleteRoute = async (id, domain) => {
        if (!await confirm(t("routes.deleteConfirm"), { confirmLabel: t("common.delete"), danger: true })) return;
        try {
            const result = await apiFetch(`/routes/${id}`, { method: "DELETE" }, onUnauth);
            if (domain && notes[domain]) {
                await apiFetch(`/route-notes/${encodeURIComponent(domain)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "" }) }, onUnauth).catch(() => {});
                setNotes(n => { const u = { ...n }; delete u[domain]; return u; });
            }
            notifyConfigurationSave(toast, t, result, t("routes.removed")); load(); loadHealth();
        } catch (e) { toast.error(localizeError(e, t), e); }
    };

    const toggleMaintenance = async (domain) => {
        const inMaint = !!maintenance[domain];
        if (!inMaint && !await confirm(t("routes.enableMaintenanceConfirm", { domain }), { confirmLabel: t("common.enable") })) return;
        try {
            let result;
            if (inMaint) {
                result = await apiFetch(`/routes/caddyfile/${encodeURIComponent(domain)}/maintenance`, { method: "DELETE" }, onUnauth);
            } else {
                result = await apiFetch(`/routes/caddyfile/${encodeURIComponent(domain)}/maintenance`, { method: "POST" }, onUnauth);
            }
            notifyConfigurationSave(toast, t, result, inMaint
                ? t("routes.maintenanceDisabled", { domain })
                : t("routes.maintenanceEnabled", { domain }));
            load(); loadHealth();
        } catch (e) { toast.error(localizeError(e, t), e); }
    };

    const getHost = getRouteHost;

    const getTitle = route => getRouteTitle(route, notes[getHost(route)]);

    const getUpstream = (route) => getRouteUpstreams(route).join(", ") || "—";

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

    const excludes = new Set(routeCheckExcludes);

    // Status shown in the Status column. With route checks on, routes that
    // can be requested by name (and aren't skipped) use their own check, like
    // the Metrics page; everything else follows its upstreams.
    // status: online | partial | offline | pending (not checked yet) | none (nothing to check)
    const getRouteStatus = (route) => {
        const domain = getHost(route);
        if (maintenance[domain]) {
            return { status: "maintenance", pct: null, failure: null, history: null };
        }
        const checkHost = routeChecks ? getRouteCheckHost(route) : null;
        if (checkHost && !excludes.has(checkHost.toLowerCase())) {
            const stats = routeUptime[checkHost];
            return {
                status: !stats ? "pending" : stats.currentlyOnline ? "online" : "offline",
                pct: stats && stats.total > 0 ? stats.pct : null,
                failure: stats && !stats.currentlyOnline ? stats.lastFailure || null : null,
                history: { route: checkHost },
            };
        }
        const upstreams = getRouteUpstreams(route);
        if (!upstreams.length) return { status: "none", pct: null, failure: null, history: null };
        const stats = uptime[upstreams[0]];
        const checked = upstreams.some(u => u in health);
        const allOnline = upstreams.every(u => health[u] === true);
        const anyOnline = upstreams.some(u => health[u] === true);
        return {
            status: !checked ? "pending" : allOnline ? "online" : anyOnline ? "partial" : "offline",
            pct: stats && stats.total > 1 ? stats.pct : null,
            failure: null,
            history: { upstream: upstreams[0] },
        };
    };

    const getUptimePct = (route) => getRouteStatus(route).pct;

    const getHealthTitle = ({ status, pct, failure, history }) => {
        if (status === "maintenance") return t("routes.maintenanceMode");
        if (status === "none") return t("routes.noUpstream");
        if (status === "pending") return history?.route ? t("routes.waitingForRouteCheck") : t("common.checking");
        const label = [t(STATUS_STYLE[status].labelKey), failure].filter(Boolean).join(" — ");
        return pct !== null ? t("routes.uptimeTitle", { label, pct: formatPercent(pct) }) : label;
    };

    const getHealthDot = ({ status, pct }) => {
        const pctText = pct !== null ? formatPercent(pct) : t("common.notAvailable");
        if (status === "none") {
            return <span className="health-dot health-dot--none"><span className="sr-only">{t("routes.noUpstreamStatus", { pct: pctText })}</span></span>;
        }
        if (status === "pending") {
            return <span className="health-dot health-dot--pending"><span className="sr-only">{t("routes.checkingStatus", { pct: pctText })}</span></span>;
        }
        const { labelKey, color } = STATUS_STYLE[status];
        return (
            <span className="health-dot" style={{ background: color, boxShadow: `0 0 4px ${color}` }}>
                <span className="sr-only">{t("routes.statusWithPct", { status: t(labelKey), pct: pctText })}</span>
            </span>
        );
    };

    const routeStatuses = routes.map(getRouteStatus).filter(s => s.status in STATUS_STYLE);
    const routesMaint = routeStatuses.filter(s => s.status === "maintenance").length;
    const routesOnline = routeStatuses.filter(s => s.status === "online").length;

    const handleSort = (col) => {
        if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
        else { setSortCol(col); setSortDir("asc"); }
    };

    const serverText = (r) => serverLabels[r._server] || r._server || "";

    const filtered = routes.filter(r => {
        if (!search) return true;
        const q = search.toLowerCase();
        return getHost(r).toLowerCase().includes(q) || getUpstream(r).toLowerCase().includes(q) || getTitle(r).toLowerCase().includes(q) || (r._server || "").toLowerCase().includes(q) || serverText(r).toLowerCase().includes(q);
    });

    const sorted = [...filtered].sort((a, b) => {
        let valA, valB;
        if (sortCol === "domain") { valA = getHost(a); valB = getHost(b); }
        else if (sortCol === "title") { valA = getTitle(a); valB = getTitle(b); }
        else if (sortCol === "upstream") { valA = getUpstream(a); valB = getUpstream(b); }
        else if (sortCol === "uptime") {
            valA = getUptimePct(a) ?? 101;
            valB = getUptimePct(b) ?? 101;
            const diff = sortDir === "asc" ? valA - valB : valB - valA;
            return diff !== 0 ? diff : getHost(a).localeCompare(getHost(b));
        }
        else { valA = serverText(a); valB = serverText(b); }
        return sortDir === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });

    const SortIcon = ({ col }) => {
        if (sortCol !== col) return <span className="sort-icon"><UtilityIcon name="sort" /></span>;
        return <span className="sort-icon--active"><UtilityIcon name={sortDir === "asc" ? "arrowUp" : "arrowDown"} /></span>;
    };

    if (loading) return <div className="loading">{t("routes.loading")}</div>;

    return (
        <>
            <div className="gap-16">
                <div className="flex-between routes-toolbar">
                    <div className="flex-center" style={{ gap: 12 }}>
                        <div className="search-wrap">
                            <input className="search-input search-input--clearable" placeholder={t("routes.filterPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} />
                            {search && <button className="search-clear" onClick={() => setSearch("")} title={t("routes.clearFilter")}><UtilityIcon name="close" /></button>}
                        </div>
                        <span className="section-label">
                            {healthLoading ? t("common.checking") : `${t("routes.onlineSummary", { online: routesOnline, total: routeStatuses.length })}${routesMaint ? ` · ${t("routes.maintenanceCount", { count: routesMaint })}` : ""}`}
                        </span>
                    </div>
                    <div className="btn-row routes-toolbar-actions">
                        <div className="col-picker" ref={colMenuRef}>
                            <button className="btn btn-ghost col-picker-trigger" onClick={() => setColMenuOpen(o => !o)}>
                                <UtilityIcon name="settings" /> {t("routes.columns")}
                                {columnsHidden && <span className="col-picker-badge" title={t("routes.someColumnsHidden")} />}
                            </button>
                            {colMenuOpen && (
                                <div className="col-picker-menu">
                                    {TOGGLEABLE_COLUMNS.map(c => (
                                        <label key={c.key} className="col-picker-item">
                                            <input type="checkbox" checked={columns[c.key]} onChange={() => toggleColumn(c.key)} />
                                            {t(c.labelKey)}
                                        </label>
                                    ))}
                                    <div className="col-picker-note">{t("routes.domainActionsAlwaysShown")}</div>
                                </div>
                            )}
                        </div>
                        <button className="btn btn-ghost" onClick={loadHealth} disabled={healthLoading}><UtilityIcon name="refresh" /> {t("common.refresh")}</button>
                        <button className="btn btn-primary" onClick={() => setNewModal(true)}>+ {t("routes.addRoute")}</button>
                    </div>
                </div>
                <div className="card card-flush">
                    {sorted.length === 0 ? (
                        <div className="card-empty">
                            {loadError && !routes.length ? localizeError(loadError, t) : search ? t("routes.noMatching", { search }) : t("routes.noneConfigured")}
                        </div>
                    ) : (
                        <div className="table-wrap">
                            <table className="table">
                                <thead>
                                    <tr>
                                        {columns.status && <th className="th-sortable col-status" onClick={() => handleSort("uptime")}>{t("routes.status")} <SortIcon col="uptime" /></th>}
                                        <th className="th-sortable" onClick={() => handleSort("domain")}>{t("routes.domain")} <SortIcon col="domain" /></th>
                                        {columns.title && <th className="th-sortable col-title" onClick={() => handleSort("title")}>{t("routes.title")} <SortIcon col="title" /></th>}
                                        {columns.upstream && <th className="th-sortable" onClick={() => handleSort("upstream")}>{t("routes.upstream")} <SortIcon col="upstream" /></th>}
                                        {columns.server && <th className="th-sortable" onClick={() => handleSort("server")}>{t("routes.server")} <SortIcon col="server" /></th>}
                                        {columns.id && <th>{t("routes.id")}</th>}
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
                                        const title = getTitle(r);
                                        const routeStatus = getRouteStatus(r);
                                        return (
                                            <tr key={r["@id"] || i}>
                                                {columns.status && (
                                                    <td
                                                        className={`col-status${routeStatus.history ? " col-status--clickable" : ""}`}
                                                        title={getHealthTitle(routeStatus)}
                                                        onClick={() => routeStatus.history && setHistoryModal({ ...routeStatus.history, title: note || domain })}
                                                    >{getHealthDot(routeStatus)}</td>
                                                )}
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
                                                            {maintenance[domain] && <span className="badge badge-muted" style={{ marginLeft: 8, fontSize: 11 }}>{t("routes.maintenance")}</span>}
                                                            {title && <div className={`route-note route-note--mobile${!note ? " route-title--fallback" : ""}`}>{title}</div>}
                                                        </div>
                                                    </div>
                                                </td>
                                                {columns.title && <td className={`col-title cell-muted${title && !note ? " route-title--fallback" : ""}`}>{title || "—"}</td>}
                                                {columns.upstream && (
                                                    <td>
                                                        {uLink ? <a href={uLink} target="_blank" rel="noopener noreferrer" className="mono route-link upstream">{upstream}</a> : <span className="mono" style={{ color: "var(--accent2)" }}>{upstream}</span>}
                                                    </td>
                                                )}
                                                {columns.server && (
                                                    <td
                                                        className={`mono cell-muted${r._server ? " server-cell--filterable" : ""}`}
                                                        onClick={() => r._server && setSearch(r._server)}
                                                        title={r._server ? t("routes.serverFilterTitle", { id: r._server }) : undefined}
                                                    >{serverText(r) || "—"}</td>
                                                )}
                                                {columns.id && <td className="mono cell-muted">{r["@id"] || "—"}</td>}
                                                <td className="col-actions">
                                                    <div className="btn-row flex-end route-actions">
                                                        {!hasId && (
                                                            <button
                                                                className="btn btn-ghost btn--icon"
                                                                style={{ color: maintenance[domain] ? "var(--accent3)" : "var(--muted)" }}
                                                                onClick={() => toggleMaintenance(domain)}
                                                                title={maintenance[domain] ? t("routes.disableMaintenance") : t("routes.enableMaintenance")}
                                                            ><UtilityIcon name="wrench" /></button>
                                                        )}
                                                        <button
                                                            className="btn btn-ghost btn--icon"
                                                            style={{ color: note ? "var(--accent2)" : "var(--muted)" }}
                                                            onClick={() => openEdit(r)}
                                                            title={t("routes.editRoute")}
                                                        ><UtilityIcon name="pencil" /></button>
                                                        {hasId && <button className="btn btn-danger btn--icon" onClick={() => deleteRoute(r["@id"], domain)} aria-label={t("common.delete")}><UtilityIcon name="close" /></button>}
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
                    inMaintenance={!!maintenance[editModal.domain]}
                    onSave={handleEditSave}
                    onDelete={() => deleteCaddyfileBlock(editModal.domain)}
                    onClose={() => setEditModal(null)}
                    theme={theme}
                />
            )}
            {newModal && <NewRouteModal onSave={addRoute} onClose={() => setNewModal(false)} />}
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

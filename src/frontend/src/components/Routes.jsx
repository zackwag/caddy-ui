import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { useClickOutside } from "../hooks/useClickOutside.js";
import { useLoad } from "../hooks/usePoll.js";
import { useRouteStatuses } from "../hooks/useRouteStatuses.js";
import { useSort } from "../hooks/useSort.jsx";
import { DEFAULT_SETTINGS } from "../settings.js";
import { apiFetch } from "../utils/api.js";
import { localizeError } from "../utils/errorMessages.js";
import { formatPercent } from "../utils/format.js";
import { compareUptime, getRouteHost, getRouteHosts, getRouteTitle, getRouteUpstreams, STATUS_LABEL_KEYS } from "../utils/routes.js";
import CaddyfileEditor from "./CaddyfileEditor.jsx";
import HealthDot from "./HealthDot.jsx";
import { UtilityIcon } from "./Icons.jsx";
import Modal from "./Modal.jsx";
import RouteHistoryModal from "./RouteHistoryModal.jsx";
import SearchInput from "./SearchInput.jsx";

// eslint-disable-next-line i18next/no-literal-string -- Example hostname
const DOMAIN_PLACEHOLDER = "app.example.com";

// What a UI-managed route's forms ask for.
function RouteFields({ form, setForm, autoFocus = false }) {
    const { t } = useTranslation();
    const routeField = key => ({ value: form[key], onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) });
    return (
        <>
            <div className="field">
                <label>{t("routes.domain")}</label>
                <input dir="ltr" {...routeField("domain")} placeholder={DOMAIN_PLACEHOLDER} autoFocus={autoFocus} />
            </div>
            <div className="field">
                <label>{t("routes.upstream")}</label>
                <input dir="ltr" {...routeField("upstream")} placeholder="192.168.4.88:8080" />
            </div>
            <div className="field">
                <label>{t("routes.stripPrefixOptional")}</label>
                <input dir="ltr" {...routeField("stripPrefix")} placeholder="/api" />
            </div>
        </>
    );
}

function EditModal({ route, initialNote, canTitle, isCaddyfileManaged, siteBlockFailed, initialContent, titleNeedsMigration, inMaintenance, onSave, onDelete, onClose, theme, editorVim }) {
    const { t } = useTranslation();
    const [form, setForm] = useState({
        domain: route.domain,
        upstream: route.upstream,
        stripPrefix: route.stripPrefix,
    });
    const [title, setTitle] = useState(initialNote || "");
    const [content, setContent] = useState(initialContent || "");
    const [saving, setSaving] = useState(false);

    const canSave = isCaddyfileManaged ? content.trim().length > 0 : !!form.upstream;
    const isModified = () => title !== (initialNote || "") || content !== (initialContent || "")
        || form.upstream !== route.upstream || form.stripPrefix !== route.stripPrefix;

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave({ form, title, content });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={t("routes.editRoute")} style={isCaddyfileManaged ? { width: 560 } : undefined} onClose={onClose} dirty={isModified()}>

            {/* A route without a host has nowhere to keep a title */}
            {canTitle && <>
                <div className="modal-section-label">{t("routes.title")}</div>
                <div className="field">
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("routes.titlePlaceholder")} onKeyDown={e => { if (e.key === 'Enter' && canSave) { handleSave(); } }} />
                </div>
                <div className="modal-hint">{titleNeedsMigration ? t("routes.titleMigrationHint") : t("routes.titleClearHint")}</div>
            </>}

            {inMaintenance && (
                <div className="modal-hint" style={{ marginTop: 12, padding: "12px 14px", background: "color-mix(in srgb, var(--accent3) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--accent3) 30%, transparent)", borderRadius: 4, color: "var(--accent3)" }}>
                    <UtilityIcon name="wrench" /> {t("routes.maintenanceEditHint")}
                </div>
            )}
            {isCaddyfileManaged && !siteBlockFailed && inMaintenance === null && (
                <div className="modal-hint" style={{ marginTop: 12 }}>{t("routes.maintenanceUnknownHint")}</div>
            )}

            {isCaddyfileManaged && siteBlockFailed ? (
                <div className="modal-hint" style={{ marginTop: 12, padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4 }}>
                    <Trans i18nKey="routes.caddyfileLoadFailed" components={{ strong: <strong /> }} />
                </div>
            ) : isCaddyfileManaged && inMaintenance === false ? (
                <>
                    <div className="modal-section-label">{t("routes.caddyfile")}</div>
                    <div className="editor-wrap" style={{ marginBottom: 16 }}>
                        <CaddyfileEditor className="modal-editor-wrap" padding="12px" value={content} onChange={setContent} onSave={() => { if (canSave && !saving) { handleSave(); } }} onQuit={onClose} isModified={isModified} theme={theme} vimMode={editorVim} />
                    </div>
                </>
            ) : !isCaddyfileManaged && (
                <>
                    <div className="modal-section-divider" />
                    <RouteFields form={form} setForm={setForm} />
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
        </Modal>
    );
}

function NewRouteModal({ onSave, onClose }) {
    const { t } = useTranslation();
    const [form, setForm] = useState({ domain: "", upstream: "", stripPrefix: "" });

    return (
        <Modal title={t("routes.newRoute")} onClose={onClose} dirty={Object.values(form).some(Boolean)}>
            <RouteFields form={form} setForm={setForm} autoFocus />
            <div className="btn-row flex-end" style={{ marginTop: 20 }}>
                <button className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
                <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.upstream || !form.domain}>
                    {t("routes.addRoute")}
                </button>
            </div>
        </Modal>
    );
}

// In the order the settings list them; each is labeled by its header.
const TOGGLEABLE_COLUMNS = Object.keys(DEFAULT_SETTINGS.routeColumns);

export default function Routes({ toast, confirm, theme, routeColumns, onRouteColumnsChange, routeChecks, routeCheckExcludes, editorVim }) {
    const { t } = useTranslation();
    const [searchParams] = useSearchParams();
    const { routes: loadedRoutes, routesError: loadError, notes, setNotes, notesError, statusOf: checkedStatusOf, checking, reload: reloadRoutes }
        = useRouteStatuses({ toast, routeChecks, routeCheckExcludes });
    const routes = loadedRoutes || [];
    // The error stays until a load succeeds, so an outage isn't shown as "no routes"
    const loading = !loadedRoutes && !loadError;
    const [certs, setCerts] = useState([]);
    // Dashboard labels by Server ID, e.g. { srv0: "HTTPS Sites" }
    const [serverLabels, setServerLabels] = useState({});
    // Domains in maintenance; null while unknown, when it can't be changed
    const [maintenance, setMaintenance] = useState(null);
    const [editModal, setEditModal] = useState(null);
    const [newModal, setNewModal] = useState(false);
    const [historyModal, setHistoryModal] = useState(null);
    const sort = useSort("domain");
    const [search, setSearch] = useState(searchParams.get("filter") || "");
    const [colMenuOpen, setColMenuOpen] = useState(false);
    const colMenuRef = useRef(null);

    useClickOutside(colMenuRef, () => setColMenuOpen(false), colMenuOpen);

    const toggleColumn = (key) => onRouteColumnsChange({ ...routeColumns, [key]: !routeColumns[key] });
    const columnsHidden = TOGGLEABLE_COLUMNS.some(key => !routeColumns[key]);

    const loadExtras = useCallback(signal => {
        // Only picks http or https for domain links, so a failure isn't reported here
        apiFetch("/tls", { signal }).then(setCerts).catch(() => { });
        apiFetch("/server-names", { signal }).then(setServerLabels).catch(() => { });
        toast.track('routeMaintenance.load', apiFetch("/routes/maintenance", { signal }), { signal })
            .then(setMaintenance, () => setMaintenance(null));
    }, [toast]);

    useLoad(loadExtras);

    const load = () => { reloadRoutes(); loadExtras(); };

    // Caddy refused a route edit because the config changed since it was read.
    // Show the current routes instead of the stale ones, and close an edit
    // based on them; a new route's form didn't come from the loaded config.
    const failRouteEdit = (e) => {
        toast.error(e);
        if (e.code !== "CONFIG_CHANGED") {
            return;
        }
        setEditModal(null); load();
    };

    const saveNote = async (domain, note) => {
        await apiFetch(`/route-notes/${encodeURIComponent(domain)}`, { method: "PUT", json: { note } });
        setNotes(({ [domain]: _, ...rest }) => note.trim() ? { ...rest, [domain]: note.trim() } : rest);
    };

    const addRoute = async (form) => {
        try {
            const result = await apiFetch("/routes", { method: "POST", json: form });
            toast.saved(result, t("routes.added", { domain: form.domain }));
            setNewModal(false); load();
        } catch (e) { failRouteEdit(e); }
    };

    const deleteCaddyfileBlock = async (domain) => {
        if (!await confirm(t("routes.deleteCaddyfileConfirm"), { confirmLabel: t("common.delete"), danger: true })) {
            return;
        }
        try {
            const result = await apiFetch(`/routes/caddyfile/${encodeURIComponent(domain)}`, { method: "DELETE" });
            if (notes[domain]) {
                await saveNote(domain, "").catch(() => { });
            }
            toast.saved(result, t("routes.removed"));
            setEditModal(null); load();
        } catch (e) { toast.error(e); }
    };

    const handleEditSave = async ({ form, title, content }) => {
        const { domain, id, isCaddyfileManaged, siteBlockFailed } = editModal;
        const editsSiteBlock = isCaddyfileManaged && !siteBlockFailed;
        try {
            if (editsSiteBlock) {
                const result = await apiFetch(`/routes/caddyfile/${encodeURIComponent(domain)}`, { method: "PATCH", json: { content, title } });
                toast.saved(result, t("routes.caddyfileUpdated"));
            } else if (!isCaddyfileManaged) {
                const result = await apiFetch(`/routes/${id}`, { method: "PATCH", json: form });
                toast.saved(result, t("routes.updated"));
            }
            // With Caddyfile titles, the site block already has it. Without loaded
            // notes the title field starts blank, so blank can't mean "clear the note"
            const titleInSiteBlock = editsSiteBlock && editModal.caddyfileTitle !== null;
            if (domain && !titleInSiteBlock && !(notesError && !title.trim())) {
                await saveNote(domain, title);
                if (siteBlockFailed) {
                    toast.success(t("routes.titleSaved"));
                }
            }
            setEditModal(null); load();
        } catch (e) { failRouteEdit(e); }
    };

    const deleteRoute = async (id, domain) => {
        if (!await confirm(t("routes.deleteConfirm"), { confirmLabel: t("common.delete"), danger: true })) {
            return;
        }
        try {
            const result = await apiFetch(`/routes/${id}`, { method: "DELETE" });
            if (notes[domain]) {
                await saveNote(domain, "").catch(() => { });
            }
            toast.saved(result, t("routes.removed")); load();
        } catch (e) { failRouteEdit(e); }
    };

    const toggleMaintenance = async (domain) => {
        const inMaint = !!maintenance?.[domain];
        if (!inMaint && !await confirm(t("routes.enableMaintenanceConfirm", { domain }), { confirmLabel: t("common.enable") })) {
            return;
        }
        try {
            const result = await apiFetch(`/routes/caddyfile/${encodeURIComponent(domain)}/maintenance`, { method: inMaint ? "DELETE" : "POST" });
            toast.saved(result, inMaint
                ? t("routes.maintenanceDisabled", { domain })
                : t("routes.maintenanceEnabled", { domain }));
            load();
        } catch (e) { toast.error(e); }
    };

    const getTitle = route => getRouteTitle(route, notes[getRouteHost(route)]);

    const getUpstream = (route) => getRouteUpstreams(route).join(", ");

    const getStripPrefix = (route) => (route.match?.find(m => m.path)?.path?.[0] || "").replace("/*", "");

    const openEdit = async (route) => {
        const domain = getRouteHost(route);
        const id = route["@id"] || null;
        const isCaddyfileManaged = !id;

        let content = "";
        let caddyfileTitle = null;
        let siteBlockFailed = false;
        if (isCaddyfileManaged) {
            try {
                const result = await apiFetch(`/routes/caddyfile/${encodeURIComponent(domain)}`);
                content = result.content || "";
                if (result.title !== undefined) {
                    caddyfileTitle = result.title;
                }
            } catch {
                siteBlockFailed = true;
            }
        }

        setEditModal({
            route: { domain, upstream: getUpstream(route), stripPrefix: getStripPrefix(route) },
            id,
            domain,
            isCaddyfileManaged,
            content,
            caddyfileTitle,
            siteBlockFailed,
        });
    };

    const getDomainScheme = (domain) => {
        if (domain.startsWith("http://")) {
            return "http";
        }
        return certs.some(c => c.domain === domain && c.status !== "orphaned") ? "https" : "http";
    };

    const domainLink = (domain) => {
        const clean = domain.replace(/^https?:\/\//, "");
        return `${getDomainScheme(clean)}://${clean}`;
    };

    // Shown in the Status column; a route in maintenance isn't serving what its
    // checks would say about it.
    const statusOf = (route) => maintenance?.[getRouteHost(route)]
        ? { status: "maintenance", pct: null, failure: null, history: null }
        : checkedStatusOf(route);

    const getHealthTitle = ({ status, pct, failure, history }) => {
        if (status === "maintenance") {
            return t("routes.maintenanceMode");
        }
        if (status === "none") {
            return t("routes.noUpstream");
        }
        if (status === "unknown") {
            return history?.route ? t("routes.waitingForRouteCheck") : t("common.checking");
        }
        const label = [t(STATUS_LABEL_KEYS[status]), failure].filter(Boolean).join(" — ");
        return pct !== null ? t("routes.uptimeTitle", { label, pct: formatPercent(pct) }) : label;
    };

    const getHealthLabel = ({ status, pct }) => {
        const pctText = pct !== null ? formatPercent(pct) : t("common.notAvailable");
        if (status === "none") {
            return t("routes.noUpstreamStatus", { pct: pctText });
        }
        if (status === "unknown") {
            return t("routes.checkingStatus", { pct: pctText });
        }
        return t("routes.statusWithPct", { status: t(STATUS_LABEL_KEYS[status]), pct: pctText });
    };

    const routeStatuses = routes.map(statusOf).filter(s => s.status !== "none" && s.status !== "unknown");
    const routesMaint = routeStatuses.filter(s => s.status === "maintenance").length;
    const routesOnline = routeStatuses.filter(s => s.status === "online").length;

    const serverText = (r) => serverLabels[r._server] || r._server || "";

    const filtered = routes.filter(r => {
        if (!search) {
            return true;
        }
        const q = search.toLowerCase();
        return getRouteHost(r).toLowerCase().includes(q) || getUpstream(r).toLowerCase().includes(q) || getTitle(r).toLowerCase().includes(q) || (r._server || "").toLowerCase().includes(q) || serverText(r).toLowerCase().includes(q);
    });

    const byText = text => (a, b) => text(a).localeCompare(text(b));
    const compare = {
        domain: byText(getRouteHost),
        title: byText(getTitle),
        upstream: byText(getUpstream),
        server: byText(serverText),
        uptime: (a, b) => compareUptime(statusOf(a), statusOf(b)),
    }[sort.column];
    const sorted = [...filtered].sort((a, b) => (sort.ascending ? compare(a, b) : compare(b, a)) || byText(getRouteHost)(a, b));

    if (loading) {
        return <div className="loading">{t("routes.loading")}</div>;
    }

    return (
        <>
            <div className="gap-16">
                <div className="flex-between routes-toolbar">
                    <div className="flex-center" style={{ gap: 12 }}>
                        <SearchInput value={search} onChange={setSearch} placeholder={t("routes.filterPlaceholder")} clearLabel={t("routes.clearFilter")} />
                        <span className="section-label">
                            {checking ? t("common.checking") : `${t("routes.onlineSummary", { online: routesOnline, total: routeStatuses.length })}${routesMaint ? ` · ${t("routes.maintenanceCount", { count: routesMaint })}` : ""}`}
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
                                    {TOGGLEABLE_COLUMNS.map(key => (
                                        <label key={key} className="col-picker-item">
                                            <input type="checkbox" checked={routeColumns[key]} onChange={() => toggleColumn(key)} />
                                            {t(`routes.${key}`)}
                                        </label>
                                    ))}
                                    <div className="col-picker-note">{t("routes.domainActionsAlwaysShown")}</div>
                                </div>
                            )}
                        </div>
                        <button className="btn btn-ghost" onClick={load} disabled={checking}><UtilityIcon name="refresh" /> {t("common.refresh")}</button>
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
                                        {routeColumns.status && <th className="th-sortable col-status" {...sort.header("uptime")}>{t("routes.status")} {sort.icon("uptime")}</th>}
                                        <th className="th-sortable" {...sort.header("domain")}>{t("routes.domain")} {sort.icon("domain")}</th>
                                        {routeColumns.title && <th className="th-sortable col-title" {...sort.header("title")}>{t("routes.title")} {sort.icon("title")}</th>}
                                        {routeColumns.upstream && <th className="th-sortable" {...sort.header("upstream")}>{t("routes.upstream")} {sort.icon("upstream")}</th>}
                                        {routeColumns.server && <th className="th-sortable" {...sort.header("server")}>{t("routes.server")} {sort.icon("server")}</th>}
                                        {routeColumns.id && <th>{t("routes.id")}</th>}
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.map((r, i) => {
                                        const domain = getRouteHost(r);
                                        const hosts = getRouteHosts(r);
                                        const upstream = getUpstream(r);
                                        const hasId = !!r["@id"];
                                        const note = notes[domain];
                                        const title = getTitle(r);
                                        const routeStatus = statusOf(r);
                                        return (
                                            <tr key={r["@id"] || i}>
                                                {routeColumns.status && (
                                                    <td
                                                        className={`col-status${routeStatus.history ? " col-status--clickable" : ""}`}
                                                        title={getHealthTitle(routeStatus)}
                                                        onClick={() => routeStatus.history && setHistoryModal({ ...routeStatus.history, title: note || domain })}
                                                    ><HealthDot status={routeStatus.status} label={getHealthLabel(routeStatus)} /></td>
                                                )}
                                                <td>
                                                    <div className="route-domain-cell">
                                                        <div>
                                                            {hosts.length > 0 ? hosts.map((h, hi) => (
                                                                <span key={h}>
                                                                    {hi > 0 && <span className="route-domain-sep">, </span>}
                                                                    <a href={domainLink(h)} target="_blank" rel="noopener noreferrer" className="mono route-link">{h}</a>
                                                                </span>
                                                            )) : <span className="mono">—</span>}
                                                            {maintenance?.[domain] && <span className="badge badge-muted" style={{ marginLeft: 8, fontSize: 11 }}>{t("routes.maintenance")}</span>}
                                                            {title && <div className={`route-note route-note--mobile${!note ? " route-title--fallback" : ""}`}>{title}</div>}
                                                        </div>
                                                    </div>
                                                </td>
                                                {routeColumns.title && <td className={`col-title cell-muted${title && !note ? " route-title--fallback" : ""}`}>{title || "—"}</td>}
                                                {routeColumns.upstream && (
                                                    <td>
                                                        {maintenance?.[domain]
                                                            ? <span className="cell-muted">{t("routes.maintenanceMode")}</span>
                                                            : upstream ? <a href={`http://${upstream}`} target="_blank" rel="noopener noreferrer" className="mono route-link upstream">{upstream}</a> : <span className="mono" style={{ color: "var(--accent2)" }}>—</span>}
                                                    </td>
                                                )}
                                                {routeColumns.server && (
                                                    <td
                                                        className={`mono cell-muted${r._server ? " server-cell--filterable" : ""}`}
                                                        onClick={() => r._server && setSearch(r._server)}
                                                        title={r._server ? t("routes.serverFilterTitle", { id: r._server }) : undefined}
                                                    >{serverText(r) || "—"}</td>
                                                )}
                                                {routeColumns.id && <td className="mono cell-muted">{r["@id"] || "—"}</td>}
                                                <td className="col-actions">
                                                    <div className="btn-row flex-end route-actions">
                                                        {!hasId && domain && (
                                                            <button
                                                                className="btn btn-ghost btn--icon"
                                                                style={{ color: maintenance?.[domain] ? "var(--accent3)" : "var(--muted)" }}
                                                                onClick={() => toggleMaintenance(domain)}
                                                                disabled={!maintenance}
                                                                title={maintenance?.[domain] ? t("routes.disableMaintenance") : t("routes.enableMaintenance")}
                                                            ><UtilityIcon name="wrench" /></button>
                                                        )}
                                                        {(hasId || domain) && <button
                                                            className="btn btn-ghost btn--icon"
                                                            style={{ color: note ? "var(--accent2)" : "var(--muted)" }}
                                                            onClick={() => openEdit(r)}
                                                            title={t("routes.editRoute")}
                                                        ><UtilityIcon name="pencil" /></button>}
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
                    canTitle={!!editModal.domain}
                    isCaddyfileManaged={editModal.isCaddyfileManaged}
                    siteBlockFailed={editModal.siteBlockFailed}
                    initialContent={editModal.content || ""}
                    titleNeedsMigration={editModal.isCaddyfileManaged && editModal.caddyfileTitle !== null && !editModal.caddyfileTitle && !!notes[editModal.domain]}
                    inMaintenance={maintenance && !!maintenance[editModal.domain]}
                    onSave={handleEditSave}
                    onDelete={() => deleteCaddyfileBlock(editModal.domain)}
                    onClose={() => setEditModal(null)}
                    theme={theme}
                    editorVim={editorVim}
                />
            )}
            {newModal && <NewRouteModal onSave={addRoute} onClose={() => setNewModal(false)} />}
            {historyModal && <RouteHistoryModal {...historyModal} onClose={() => setHistoryModal(null)} />}
        </>
    );
}

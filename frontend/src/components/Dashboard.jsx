import { localizeError } from "../utils/errorMessages.js";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { apiFetch } from "../utils/api.js";
import { currentLocale, formatNumber } from "../utils/format.js";

export default function Dashboard({ status, toast, onUnauth }) {
    const { t } = useTranslation();
    const [names, setNames] = useState({});
    const [editingServer, setEditingServer] = useState(null);
    const [editName, setEditName] = useState("");
    const [health, setHealth] = useState(null);
    const [process, setProcess] = useState(null);

    const navigate = useNavigate();

    const loadProcess = useCallback(() => {
        apiFetch("/status/process", {}, onUnauth).then(setProcess).catch(() => { });
    }, [onUnauth]);

    useEffect(() => {
        apiFetch("/server-names", {}, onUnauth).then(setNames).catch(() => { });
        apiFetch("/health", {}, onUnauth).then(results => {
            const total = results.length;
            const online = results.filter(r => r.online).length;
            setHealth({ total, online, offline: total - online });
        }).catch(() => { });
        loadProcess();
        const t = setInterval(loadProcess, 30000);
        return () => clearInterval(t);
    }, [loadProcess, onUnauth]);

    const openEdit = (server) => { setEditingServer(server); setEditName(names[server.name] || ""); };

    const saveName = async () => {
        try {
            if (editName.trim()) {
                await apiFetch(`/server-names/${editingServer.name}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editName }) }, onUnauth);
                setNames(n => ({ ...n, [editingServer.name]: editName.trim() }));
                toast.success(t("dashboard.labelSaved"));
            } else {
                await apiFetch(`/server-names/${editingServer.name}`, { method: "DELETE" }, onUnauth);
                setNames(n => { const x = { ...n }; delete x[editingServer.name]; return x; });
                toast.success(t("dashboard.labelRemoved"));
            }
            setEditingServer(null);
        } catch (e) { toast.error(localizeError(e, t), e); }
    };

    const formatLastReload = (iso) => {
        if (!iso) return "—";
        return new Date(iso).toLocaleString(currentLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    };

    if (!status) return <div className="loading">{t("common.loading")}</div>;

    return (
        <>
            <div className="gap-16">
                <div className="grid-4">
                    <div className="card">
                        <div className="card-title">{t("dashboard.status")}</div>
                        <div className="stat-val" style={{ color: status.online ? "var(--accent)" : "var(--danger)" }}>{status.online ? t("dashboard.online") : t("dashboard.offline")}</div>
                        <div className="stat-label">{t("dashboard.caddyServer")}</div>
                    </div>
                    <div className="card card-clickable" onClick={() => navigate("/caddyfile")}>
                        <div className="card-title">{t("dashboard.servers")}</div>
                        <div className="stat-val">{status.online ? status.serverCount : "—"}</div>
                        <div className="stat-label">{t("dashboard.activeHttpServers")}</div>
                    </div>
                    <div className="card card-clickable" onClick={() => navigate("/tls")}>
                        <div className="card-title">{t("dashboard.tls")}</div>
                        <div className="stat-val" style={{ fontSize: 20, paddingTop: 6 }}>
                            {status.online ? <span className={`badge ${status.tlsEnabled ? "badge-green" : "badge-red"}`}>{status.tlsEnabled ? t("dashboard.enabled") : t("dashboard.disabled")}</span> : "—"}
                        </div>
                        <div className="stat-label">{t("dashboard.certificateManagement")}</div>
                    </div>
                    <div className="card card-clickable" onClick={() => navigate("/routes")}>
                        <div className="card-title">{t("dashboard.upstreams")}</div>
                        <div className="stat-val" style={{ color: !health ? "var(--text)" : health.offline > 0 ? "var(--danger)" : "var(--accent)" }}>
                            {health ? `${health.online}/${health.total}` : "—"}
                        </div>
                        <div className="stat-label">{!health ? "—" : health.offline > 0 ? t("dashboard.offlineCount", { count: health.offline }) : t("dashboard.allOnline")}</div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-title">{t("dashboard.process")}</div>
                    {!process ? (
                        <div className="loading">{t("common.loading")}</div>
                    ) : !process.ok ? (
                        <div className="flex-between">
                            <span className="loading">{t("dashboard.metricsNotEnabled")}</span>
                            <button className="btn btn-ghost btn--sm" onClick={() => navigate("/metrics")}>{t("dashboard.enableInMetrics")} →</button>
                        </div>
                    ) : (
                        <div className="process-grid">
                            {process.version && process.version !== 'unknown' && (
                                <div>
                                    <span className="field-label">{t("dashboard.version")}</span>
                                    <div className="data-val">{process.version}</div>
                                </div>
                            )}
                            <div>
                                <span className="field-label">{t("dashboard.uptime")}</span>
                                <div className="data-val data-val--accent">{process.uptime || "—"}</div>
                            </div>
                            <div>
                                <span className="field-label">{t("dashboard.heap")}</span>
                                <div className="data-val">
                                    {process.memAlloc !== null ? `${formatNumber(process.memAlloc)} MB` : "—"}
                                    {process.memSys !== null && <span className="inline-muted">/ {t("dashboard.systemMemory", { value: formatNumber(process.memSys) })}</span>}
                                </div>
                            </div>
                            <div>
                                <span className="field-label">{t("dashboard.lastReload")}</span>
                                <div className="data-val" style={{ color: process.lastReloadSuccess ? "var(--text)" : "var(--danger)" }}>
                                    {formatLastReload(process.lastReload)}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {status.online && status.servers?.length > 0 && (
                    <div className="card">
                        <div className="card-title">{t("dashboard.httpServers")}</div>
                        <div className="table-wrap">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>{t("dashboard.label")}</th>
                                        <th title={t("dashboard.serverIdHint")}>{t("dashboard.serverId")} <span className="th-hint">ⓘ</span></th>
                                        <th>{t("dashboard.listensOn")}</th>
                                        <th>{t("dashboard.routes")}</th>
                                        <th>{t("dashboard.status")}</th>
                                        <th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {status.servers.map(s => (
                                        <tr key={s.name} className="row-clickable" onClick={() => navigate(`/routes?filter=${s.name}`)} title={t("dashboard.showRoutesOn", { server: s.name })}>
                                            <td>{names[s.name] || <span className="cell-muted">—</span>}</td>
                                            <td className="mono">{s.name}</td>
                                            <td className="mono cell-muted">{s.listen?.join(", ") || t("dashboard.noListeners")}</td>
                                            <td><span className="badge badge-blue">{s.routeCount}</span></td>
                                            <td><span className="badge badge-green">{t("dashboard.active")}</span></td>
                                            <td className="cell-actions">
                                                <span
                                                    className="server-edit-icon"
                                                    title={t("dashboard.editLabel")}
                                                    onClick={e => { e.stopPropagation(); openEdit(s); }}
                                                >✎</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {!status.online && (
                    <div className="card card-danger">
                        <div className="card-title">{t("dashboard.connectionError")}</div>
                        <div className="loading">{status.errorKey ? t(status.errorKey) : status.error}</div>
                    </div>
                )}
            </div>

            {editingServer && (
                <div className="modal-overlay" onClick={() => setEditingServer(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-title">{t("dashboard.editLabel")}</div>
                        <div className="server-facts">
                            <div>
                                <span className="field-label">{t("dashboard.serverId")}</span>
                                <div className="data-val mono">{editingServer.name}</div>
                            </div>
                            <div>
                                <span className="field-label">{t("dashboard.listensOn")}</span>
                                <div className="data-val mono">{editingServer.listen?.join(", ") || t("dashboard.noListeners")}</div>
                            </div>
                            <div>
                                <span className="field-label">{t("dashboard.routes")}</span>
                                <div className="data-val mono">{editingServer.routeCount}</div>
                            </div>
                        </div>
                        <div className="field">
                            <label>{t("dashboard.label")}</label>
                            <input value={editName} onChange={e => setEditName(e.target.value)} placeholder={t("dashboard.labelPlaceholder")} autoFocus onKeyDown={e => e.key === 'Enter' && saveName()} />
                        </div>
                        <div className="modal-hint">
                            <Trans i18nKey="dashboard.labelHint" components={{ code: <code /> }} />
                        </div>
                        <div className="btn-row flex-end">
                            <button className="btn btn-ghost" onClick={() => setEditingServer(null)}>{t("common.cancel")}</button>
                            <button className="btn btn-primary" onClick={saveName}>{t("common.save")}</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

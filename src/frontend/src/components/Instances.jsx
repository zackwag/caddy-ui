import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useInstanceStatus } from "../hooks/useInstanceStatus.js";
import { apiFetch, clearInstanceId, getInstanceId } from "../utils/api.js";
import Modal from "./Modal.jsx";
import Select from "./Select.jsx";
import StatusDot from "./StatusDot.jsx";

// eslint-disable-next-line i18next/no-literal-string -- Example Caddy admin endpoint
const ADMIN_URL_PLACEHOLDER = "http://caddy:2019";

const EMPTY_FORM = {
    name: "",
    adminUrl: "",
    configPath: "/etc/caddy/Caddyfile",
    logPath: "/var/log/caddy/access.log",
    dataPath: "/data/caddy",
    containerName: "",
    serverName: "srv0",
};

export default function Instances({ toast, confirm, onInstancesChange }) {
    const { t } = useTranslation();
    const [instances, setInstances] = useState([]);
    const instanceStatus = useInstanceStatus();
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [discovered, setDiscovered] = useState(null);
    const [discovering, setDiscovering] = useState(false);
    // Live HTTP server IDs for the form's admin URL; null until loaded or
    // when Caddy can't be reached, in which case the field stays free text
    const [serverIds, setServerIds] = useState(null);
    // Dashboard labels per instance (server-names.json), e.g. { caddy: { srv0: "HTTPS Sites" } }
    const [serverLabels, setServerLabels] = useState({});
    // Live server IDs per instance, to flag a "new routes go to" server Caddy doesn't have
    const [liveServerIds, setLiveServerIds] = useState({});

    const load = useCallback(() => {
        toast.track('instances.load', apiFetch("/instances"))
            .then(setInstances)
            .catch(() => { })
            .finally(() => setLoading(false));
    }, [toast]);

    const discover = useCallback(async () => {
        setDiscovering(true);
        try {
            const containers = await apiFetch("/instances/discover");
            setDiscovered(containers);
            if (containers.length === 0) toast.success(t("instances.noNewContainers"));
        } catch (e) {
            toast.error(e);
            setDiscovered(null);
        } finally {
            setDiscovering(false);
        }
    }, [t, toast]);

    const didAutoDiscover = useRef(false);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        apiFetch("/server-names/all").then(setServerLabels).catch(() => { });
    }, []);

    useEffect(() => {
        for (const inst of instances) {
            apiFetch(`/instances/servers?adminUrl=${encodeURIComponent(inst.adminUrl)}`)
                .then(ids => setLiveServerIds(m => ({ ...m, [inst.id]: ids })))
                .catch(() => { });
        }
    }, [instances]);

    const serverLabel = (instanceId, id) => {
        const label = serverLabels[instanceId]?.[id];
        return label ? `${label} (${id})` : id;
    };

    useEffect(() => {
        if (!loading && instances.length === 0 && !didAutoDiscover.current) {
            didAutoDiscover.current = true;
            discover();
        }
    }, [loading, instances.length, discover]);

    useEffect(() => {
        const poll = () =>
            apiFetch("/instances/discover")
                .then(setDiscovered)
                .catch(() => { });
        const t = setInterval(poll, 30000);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        setServerIds(null);
        if (!editing || !form.adminUrl.trim()) return;
        let cancelled = false;
        const t = setTimeout(() => {
            apiFetch(`/instances/servers?adminUrl=${encodeURIComponent(form.adminUrl.trim())}`)
                .then(ids => { if (!cancelled) setServerIds(ids); })
                .catch(() => { });
        }, 400);
        return () => { cancelled = true; clearTimeout(t); };
    }, [editing, form.adminUrl]);

    const addDiscovered = (container) => {
        setEditing("new");
        const { containerName, adminUrl, configPath, logPath, dataPath, serverName } = container;
        setForm({ name: containerName.charAt(0).toUpperCase() + containerName.slice(1), adminUrl, configPath, logPath, dataPath, containerName, serverName });
    };

    const openAdd = () => {
        setEditing("new");
        setForm(EMPTY_FORM);
    };

    const openEdit = (inst) => {
        setEditing(inst.id);
        // A blank field shows its default, except the container name, where
        // blank means local mode
        setForm(Object.fromEntries(Object.entries(EMPTY_FORM).map(([key, fallback]) => [key, inst[key] || fallback])));
    };

    const save = async () => {
        if (!form.name.trim() || !form.adminUrl.trim()) {
            toast.failure(t("instances.nameAndAdminRequired"));
            return;
        }
        setSaving(true);
        try {
            if (editing === "new") {
                await apiFetch("/instances", { method: "POST", json: form });
                toast.success(t("instances.added"));
            } else {
                await apiFetch(`/instances/${editing}`, { method: "PUT", json: form });
                toast.success(t("instances.updated"));
            }
            setEditing(null);
            setDiscovered(null);
            load();
            onInstancesChange();
        } catch (e) {
            toast.error(e);
        } finally {
            setSaving(false);
        }
    };

    const remove = async (inst) => {
        if (!await confirm(t("instances.removeConfirm", { name: inst.name }), { confirmLabel: t("instances.remove"), danger: true })) return;
        try {
            await apiFetch(`/instances/${inst.id}`, { method: "DELETE" });
            toast.success(t("instances.removed"));
            load();
            if (inst.id === getInstanceId()) clearInstanceId();
            else onInstancesChange();
        } catch (e) {
            toast.error(e);
        }
    };

    const update = (patch) => setForm(f => ({ ...f, ...patch }));

    if (loading) return <div className="loading">{t("common.loading")}</div>;

    return (
        <>
            <div className="gap-16">
                <div className="card">
                    <div className="flex-between" style={{ marginBottom: 0 }}>
                        <div className="card-title" style={{ marginBottom: 0 }}>{t("instances.title")}</div>
                        <div className="btn-row">
                            <button className="btn btn-ghost btn--sm" onClick={discover} disabled={discovering}>
                                {discovering ? t("instances.scanning") : t("instances.discover")}
                            </button>
                            <button className="btn btn-primary btn--sm" onClick={openAdd}>+ {t("instances.addInstance")}</button>
                        </div>
                    </div>
                </div>

                {discovered && discovered.length > 0 && (
                    <div className="card">
                        <div className="card-title">{t("instances.discoveredContainers")}</div>
                        <div className="hint" style={{ marginTop: -8, marginBottom: 12 }}>
                            {t("instances.discoveredHint")}
                        </div>
                        {discovered.map(c => (
                            <div key={c.containerId} className="server-row">
                                <div>
                                    <div className="flex-center" style={{ gap: 8 }}>
                                        <span style={{ fontFamily: "var(--mono)", fontWeight: 500, fontSize: 13 }}>{c.containerName}</span>
                                        <span className="badge badge-blue">{c.image}</span>
                                    </div>
                                    <div className="server-meta">{c.adminUrl}</div>
                                </div>
                                <button className="btn btn-primary btn--sm" onClick={() => addDiscovered(c)}>{t("instances.add")}</button>
                            </div>
                        ))}
                    </div>
                )}

                {instances.map(inst => (
                    <div key={inst.id} className="card">
                        <div className="flex-between" style={{ marginBottom: 12 }}>
                            <div className="flex-center" style={{ gap: 10 }}>
                                <StatusDot online={instanceStatus[inst.id]} />
                                <span style={{ fontFamily: "var(--mono)", fontWeight: 500, fontSize: 14 }}>{inst.name}</span>
                                <span className="badge badge-muted">{inst.id}</span>
                            </div>
                            <div className="btn-row">
                                <button className="btn btn-ghost btn--sm" onClick={() => openEdit(inst)}>{t("instances.edit")}</button>
                                <button className="btn btn-danger btn--sm" onClick={() => remove(inst)}>{t("instances.remove")}</button>
                            </div>
                        </div>
                        <div className="instance-details-grid">
                            <div>
                                <span className="field-label">{t("instances.adminUrl")}</span>
                                <div className="data-val mono">{inst.adminUrl}</div>
                            </div>
                            <div>
                                <span className="field-label">{t("instances.container")}</span>
                                <div className="data-val mono">{inst.containerName || t("instances.local")}</div>
                            </div>
                            <div>
                                <span className="field-label">{t("instances.configPath")}</span>
                                <div className="data-val mono">{inst.configPath}</div>
                            </div>
                            <div>
                                <span className="field-label">{t("instances.newRoutesGoTo")}</span>
                                <div className="data-val mono">
                                    {serverLabel(inst.id, inst.serverName || EMPTY_FORM.serverName)}
                                    {liveServerIds[inst.id] && !liveServerIds[inst.id].includes(inst.serverName || EMPTY_FORM.serverName) && (
                                        <span className="badge badge-red" style={{ marginLeft: 8 }} title={t("instances.notInCaddyHint")}>{t("instances.notInCaddy")}</span>
                                    )}
                                </div>
                            </div>
                            <div>
                                <span className="field-label">{t("instances.logPath")}</span>
                                <div className="data-val mono">{inst.logPath}</div>
                            </div>
                            <div>
                                <span className="field-label">{t("instances.dataPath")}</span>
                                <div className="data-val mono">{inst.dataPath}</div>
                            </div>
                        </div>
                    </div>
                ))}

                {instances.length === 0 && !discovered?.length && !discovering && (
                    <div className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 18, fontWeight: 600, color: "var(--accent)", marginBottom: 8 }}>
                            {t("instances.welcome")}
                        </div>
                        <div className="hint" style={{ marginBottom: 20, maxWidth: 400, marginInline: "auto" }}>
                            {t("instances.emptyHint")}
                        </div>
                        <div className="btn-row" style={{ justifyContent: "center" }}>
                            <button className="btn btn-primary" onClick={discover}>{t("instances.discoverContainers")}</button>
                            <button className="btn btn-ghost" onClick={openAdd}>{t("instances.addManually")}</button>
                        </div>
                    </div>
                )}
            </div>

            {editing && (
                <Modal title={editing === "new" ? t("instances.addInstance") : t("instances.editInstance")} style={{ width: 520 }} onClose={() => setEditing(null)}>

                    <div className="field">
                        <label>{t("instances.name")}</label>
                        <input
                            value={form.name}
                            onChange={e => update({ name: e.target.value })}
                            placeholder={t("instances.namePlaceholder")}
                            autoFocus
                        />
                    </div>

                    <div className="field">
                        <label>{t("instances.adminUrl")}</label>
                        <input
                            value={form.adminUrl}
                            onChange={e => update({ adminUrl: e.target.value })}
                            placeholder={ADMIN_URL_PLACEHOLDER}
                        />
                    </div>

                    <div className="modal-section-divider" />

                    <div className="instance-form-grid">
                        <div className="field">
                            <label>{t("instances.containerName")}</label>
                            <input
                                value={form.containerName}
                                onChange={e => update({ containerName: e.target.value })}
                                placeholder={t("instances.localModePlaceholder")}
                            />
                            <div className="hint" style={{ marginTop: 4 }}>{t("instances.localModeHint")}</div>
                        </div>
                        <div className="field">
                            <label>{t("instances.newRoutesGoTo")}</label>
                            {serverIds?.length ? (
                                <Select value={form.serverName} onChange={e => update({ serverName: e.target.value })}>
                                    {!serverIds.includes(form.serverName) && (
                                        <option value={form.serverName}>{form.serverName || t("instances.none")} ({t("instances.notInCaddy")})</option>
                                    )}
                                    {serverIds.map(id => <option key={id} value={id}>{serverLabel(editing, id)}</option>)}
                                </Select>
                            ) : (
                                <input
                                    value={form.serverName}
                                    onChange={e => update({ serverName: e.target.value })}
                                    placeholder={EMPTY_FORM.serverName}
                                />
                            )}
                            <div className="hint" style={{ marginTop: 4 }}>
                                {t("instances.serverHint")}
                            </div>
                        </div>
                    </div>

                    <div className="field">
                        <label>{t("instances.caddyfilePath")}</label>
                        <input
                            value={form.configPath}
                            onChange={e => update({ configPath: e.target.value })}
                            placeholder={EMPTY_FORM.configPath}
                        />
                    </div>

                    <div className="field">
                        <label>{t("instances.logPath")}</label>
                        <input
                            value={form.logPath}
                            onChange={e => update({ logPath: e.target.value })}
                            placeholder={EMPTY_FORM.logPath}
                        />
                    </div>

                    <div className="field">
                        <label>{t("instances.dataPath")}</label>
                        <input
                            value={form.dataPath}
                            onChange={e => update({ dataPath: e.target.value })}
                            placeholder={EMPTY_FORM.dataPath}
                        />
                    </div>

                    <div className="btn-row flex-end">
                        <button className="btn btn-ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                        <button className="btn btn-primary" onClick={save} disabled={saving}>
                            {saving ? t("common.saving") : editing === "new" ? t("instances.add") : t("common.save")}
                        </button>
                    </div>
                </Modal>
            )}
        </>
    );
}

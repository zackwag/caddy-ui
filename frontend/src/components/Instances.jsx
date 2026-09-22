import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../utils/api.js";

const EMPTY_FORM = {
    name: "",
    adminUrl: "",
    configPath: "/etc/caddy/Caddyfile",
    logPath: "/var/log/caddy/access.log",
    dataPath: "/data/caddy/caddy",
    containerName: "caddy",
    serverName: "srv0",
};

export default function Instances({ toast, onUnauth, confirm, onInstanceChange }) {
    const [instances, setInstances] = useState([]);
    const [instanceStatus, setInstanceStatus] = useState({});
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        apiFetch("/instances", {}, onUnauth).then(setInstances).catch(e => toast.error(e.message)).finally(() => setLoading(false));
    }, [onUnauth, toast]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const fetchStatus = () =>
            apiFetch("/instances/status", {}, onUnauth).then(results => {
                const map = {};
                for (const r of results) map[r.id] = r.online;
                setInstanceStatus(map);
            }).catch(() => { });
        fetchStatus();
        const t = setInterval(fetchStatus, 15000);
        return () => clearInterval(t);
    }, [onUnauth]);

    const openAdd = () => {
        setEditing("new");
        setForm(EMPTY_FORM);
    };

    const openEdit = (inst) => {
        setEditing(inst.id);
        setForm({
            name: inst.name,
            adminUrl: inst.adminUrl,
            configPath: inst.configPath || "/etc/caddy/Caddyfile",
            logPath: inst.logPath || "/var/log/caddy/access.log",
            dataPath: inst.dataPath || "/data/caddy/caddy",
            containerName: inst.containerName || "caddy",
            serverName: inst.serverName || "srv0",
        });
    };

    const save = async () => {
        if (!form.name.trim() || !form.adminUrl.trim()) {
            toast.error("Name and Admin URL are required");
            return;
        }
        setSaving(true);
        try {
            if (editing === "new") {
                await apiFetch("/instances", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                }, onUnauth);
                toast.success("Instance added");
            } else {
                await apiFetch(`/instances/${editing}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                }, onUnauth);
                toast.success("Instance updated");
            }
            setEditing(null);
            load();
            if (onInstanceChange) onInstanceChange();
        } catch (e) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    };

    const remove = async (inst) => {
        if (!await confirm(`Remove instance "${inst.name}"? This cannot be undone.`, { confirmLabel: "Remove", danger: true })) return;
        try {
            await apiFetch(`/instances/${inst.id}`, { method: "DELETE" }, onUnauth);
            toast.success("Instance removed");
            load();
            if (onInstanceChange) onInstanceChange();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const update = (patch) => setForm(f => ({ ...f, ...patch }));

    if (loading) return <div className="loading">Loading...</div>;

    return (
        <>
            <div className="gap-16">
                <div className="card">
                    <div className="flex-between" style={{ marginBottom: instances.length > 0 ? 0 : undefined }}>
                        <div className="card-title" style={{ marginBottom: 0 }}>Instances</div>
                        <button className="btn btn-primary btn--sm" onClick={openAdd}>+ Add Instance</button>
                    </div>
                </div>

                {instances.map(inst => (
                    <div key={inst.id} className="card">
                        <div className="flex-between" style={{ marginBottom: 12 }}>
                            <div className="flex-center" style={{ gap: 10 }}>
                                <div className={`status-dot ${instanceStatus[inst.id] === true ? "online" : instanceStatus[inst.id] === false ? "offline" : ""}`} />
                                <span style={{ fontFamily: "var(--mono)", fontWeight: 500, fontSize: 14 }}>{inst.name}</span>
                                <span className="badge badge-muted">{inst.id}</span>
                            </div>
                            <div className="btn-row">
                                <button className="btn btn-ghost btn--sm" onClick={() => openEdit(inst)}>Edit</button>
                                {instances.length > 1 && (
                                    <button className="btn btn-danger btn--sm" onClick={() => remove(inst)}>Remove</button>
                                )}
                            </div>
                        </div>
                        <div className="instance-details-grid">
                            <div>
                                <span className="field-label">Admin URL</span>
                                <div className="data-val mono">{inst.adminUrl}</div>
                            </div>
                            <div>
                                <span className="field-label">Container</span>
                                <div className="data-val mono">{inst.containerName || "caddy"}</div>
                            </div>
                            <div>
                                <span className="field-label">Config Path</span>
                                <div className="data-val mono">{inst.configPath}</div>
                            </div>
                            <div>
                                <span className="field-label">Server Name</span>
                                <div className="data-val mono">{inst.serverName || "srv0"}</div>
                            </div>
                            <div>
                                <span className="field-label">Log Path</span>
                                <div className="data-val mono">{inst.logPath}</div>
                            </div>
                            <div>
                                <span className="field-label">Data Path</span>
                                <div className="data-val mono">{inst.dataPath}</div>
                            </div>
                        </div>
                    </div>
                ))}

                {instances.length === 0 && (
                    <div className="card">
                        <div className="card-empty">No instances configured</div>
                    </div>
                )}
            </div>

            {editing && (
                <div className="modal-overlay" onClick={() => setEditing(null)}>
                    <div className="modal" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
                        <div className="modal-title">{editing === "new" ? "Add Instance" : "Edit Instance"}</div>

                        <div className="field">
                            <label>Name</label>
                            <input
                                value={form.name}
                                onChange={e => update({ name: e.target.value })}
                                placeholder="e.g. Production Caddy"
                                autoFocus
                            />
                        </div>

                        <div className="field">
                            <label>Admin URL</label>
                            <input
                                value={form.adminUrl}
                                onChange={e => update({ adminUrl: e.target.value })}
                                placeholder="http://caddy:2019"
                            />
                        </div>

                        <div className="modal-section-divider" />

                        <div className="instance-form-grid">
                            <div className="field">
                                <label>Container Name</label>
                                <input
                                    value={form.containerName}
                                    onChange={e => update({ containerName: e.target.value })}
                                    placeholder="caddy"
                                />
                            </div>
                            <div className="field">
                                <label>Server Name</label>
                                <input
                                    value={form.serverName}
                                    onChange={e => update({ serverName: e.target.value })}
                                    placeholder="srv0"
                                />
                            </div>
                        </div>

                        <div className="field">
                            <label>Caddyfile Path</label>
                            <input
                                value={form.configPath}
                                onChange={e => update({ configPath: e.target.value })}
                                placeholder="/etc/caddy/Caddyfile"
                            />
                        </div>

                        <div className="field">
                            <label>Log Path</label>
                            <input
                                value={form.logPath}
                                onChange={e => update({ logPath: e.target.value })}
                                placeholder="/var/log/caddy/access.log"
                            />
                        </div>

                        <div className="field">
                            <label>Data Path</label>
                            <input
                                value={form.dataPath}
                                onChange={e => update({ dataPath: e.target.value })}
                                placeholder="/data/caddy/caddy"
                            />
                        </div>

                        <div className="btn-row flex-end">
                            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={save} disabled={saving}>
                                {saving ? "Saving..." : editing === "new" ? "Add" : "Save"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

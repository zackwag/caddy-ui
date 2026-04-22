import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../utils/api.js";

export default function Dashboard({ status, toast, onUnauth }) {
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
    }, [loadProcess]);

    const openEdit = (server) => { setEditingServer(server); setEditName(names[server.name] || ""); };

    const saveName = async () => {
        try {
            if (editName.trim()) {
                await apiFetch(`/server-names/${editingServer.name}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editName }) }, onUnauth);
                setNames(n => ({ ...n, [editingServer.name]: editName.trim() }));
                toast.success("Server name saved");
            } else {
                await apiFetch(`/server-names/${editingServer.name}`, { method: "DELETE" }, onUnauth);
                setNames(n => { const x = { ...n }; delete x[editingServer.name]; return x; });
                toast.success("Server name cleared");
            }
            setEditingServer(null);
        } catch (e) { toast.error(e.message); }
    };

    const formatLastReload = (iso) => {
        if (!iso) return "—";
        return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    };

    if (!status) return <div className="loading">Loading...</div>;

    return (
        <>
            <div className="gap-16">
                <div className="grid-4">
                    <div className="card">
                        <div className="card-title">Status</div>
                        <div className="stat-val" style={{ color: status.online ? "var(--accent)" : "var(--danger)" }}>{status.online ? "ONLINE" : "OFFLINE"}</div>
                        <div className="stat-label">Caddy server</div>
                    </div>
                    <div className="card card-clickable" onClick={() => navigate("/caddyfile")}>
                        <div className="card-title">Servers</div>
                        <div className="stat-val">{status.online ? status.serverCount : "—"}</div>
                        <div className="stat-label">Active server blocks</div>
                    </div>
                    <div className="card card-clickable" onClick={() => navigate("/tls")}>
                        <div className="card-title">TLS</div>
                        <div className="stat-val" style={{ fontSize: 20, paddingTop: 6 }}>
                            {status.online ? <span className={`badge ${status.tlsEnabled ? "badge-green" : "badge-red"}`}>{status.tlsEnabled ? "ENABLED" : "DISABLED"}</span> : "—"}
                        </div>
                        <div className="stat-label">Certificate management</div>
                    </div>
                    <div className="card card-clickable" onClick={() => navigate("/routes")}>
                        <div className="card-title">Upstreams</div>
                        <div className="stat-val" style={{ color: !health ? "var(--text)" : health.offline > 0 ? "var(--danger)" : "var(--accent)" }}>
                            {health ? `${health.online}/${health.total}` : "—"}
                        </div>
                        <div className="stat-label">{!health ? "—" : health.offline > 0 ? `${health.offline} offline` : "All online"}</div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-title">Process</div>
                    {!process ? (
                        <div className="loading">Loading...</div>
                    ) : !process.ok ? (
                        <div className="flex-between">
                            <span className="loading">Metrics not enabled</span>
                            <button className="btn btn-ghost btn--sm" onClick={() => navigate("/metrics")}>Enable in Metrics →</button>
                        </div>
                    ) : (
                        <div className="process-grid">
                            <div>
                                <span className="field-label">Uptime</span>
                                <div className="data-val data-val--accent">{process.uptime || "—"}</div>
                            </div>
                            <div>
                                <span className="field-label">Heap</span>
                                <div className="data-val">
                                    {process.memAlloc !== null ? `${process.memAlloc} MB` : "—"}
                                    {process.memSys !== null && <span className="inline-muted">/ {process.memSys} MB sys</span>}
                                </div>
                            </div>
                            <div>
                                <span className="field-label">Last Reload</span>
                                <div className="data-val" style={{ color: process.lastReloadSuccess ? "var(--text)" : "var(--danger)" }}>
                                    {formatLastReload(process.lastReload)}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {status.online && status.servers?.length > 0 && (
                    <div className="card">
                        <div className="card-title">Server Blocks</div>
                        {status.servers.map(s => (
                            <div className="server-row server-row--clickable" key={s.name} onClick={() => navigate(`/routes?filter=${s.name}`)}>
                                <div>
                                    <div className="flex-center">
                                        <div className="server-name">{s.name}</div>
                                        {names[s.name] && <span className="server-separator">·</span>}
                                        {names[s.name] && <span className="server-display-name">{names[s.name]}</span>}
                                    </div>
                                    <div className="server-meta">{s.listen?.join(", ") || "no listeners"}</div>
                                </div>
                                <div className="flex-center">
                                    <span className="badge badge-blue">{s.routeCount} routes</span>
                                    <span className="badge badge-green">active</span>
                                    <span
                                        className="server-edit-icon"
                                        title="Edit display name"
                                        onClick={e => { e.stopPropagation(); openEdit(s); }}
                                    >✎</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!status.online && (
                    <div className="card card-danger">
                        <div className="card-title">Connection Error</div>
                        <div className="loading">{status.error}</div>
                    </div>
                )}
            </div>

            {editingServer && (
                <div className="modal-overlay" onClick={() => setEditingServer(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-title">Edit Server Block</div>
                        <div className="modal-badges">
                            <span className="badge badge-blue">{editingServer.name}</span>
                            <span className="badge badge-green">{editingServer.listen?.join(", ")}</span>
                            <span className="badge badge-blue">{editingServer.routeCount} routes</span>
                        </div>
                        <div className="field">
                            <label>Display Name</label>
                            <input value={editName} onChange={e => setEditName(e.target.value)} placeholder={`e.g. "Main Sites" or "Internal Services"`} autoFocus onKeyDown={e => e.key === 'Enter' && saveName()} />
                        </div>
                        <div className="modal-hint">Leave blank to clear the name. This label appears next to the server key on the Dashboard.</div>
                        <div className="btn-row flex-end">
                            <button className="btn btn-ghost" onClick={() => setEditingServer(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={saveName}>Save</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

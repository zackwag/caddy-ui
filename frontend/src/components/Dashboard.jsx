import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../utils/api.js";

const SERVER_ID_HINT = "Assigned by Caddy (srv0, srv1, … by default). Set your own with the name option of the Caddyfile's global servers block.";

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
    }, [loadProcess, onUnauth]);

    const openEdit = (server) => { setEditingServer(server); setEditName(names[server.name] || ""); };

    const saveName = async () => {
        try {
            if (editName.trim()) {
                await apiFetch(`/server-names/${editingServer.name}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editName }) }, onUnauth);
                setNames(n => ({ ...n, [editingServer.name]: editName.trim() }));
                toast.success("Label saved");
            } else {
                await apiFetch(`/server-names/${editingServer.name}`, { method: "DELETE" }, onUnauth);
                setNames(n => { const x = { ...n }; delete x[editingServer.name]; return x; });
                toast.success("Label removed");
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
                        <div className="stat-label">Active HTTP servers</div>
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
                            {process.version && process.version !== 'unknown' && (
                                <div>
                                    <span className="field-label">Version</span>
                                    <div className="data-val">{process.version}</div>
                                </div>
                            )}
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
                        <div className="card-title">HTTP Servers</div>
                        <div className="table-wrap">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Label</th>
                                        <th title={SERVER_ID_HINT}>Server ID <span className="th-hint">ⓘ</span></th>
                                        <th>Listens on</th>
                                        <th>Routes</th>
                                        <th>Status</th>
                                        <th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {status.servers.map(s => (
                                        <tr key={s.name} className="row-clickable" onClick={() => navigate(`/routes?filter=${s.name}`)} title={`Show routes on ${s.name}`}>
                                            <td>{names[s.name] || <span className="cell-muted">—</span>}</td>
                                            <td className="mono">{s.name}</td>
                                            <td className="mono cell-muted">{s.listen?.join(", ") || "no listeners"}</td>
                                            <td><span className="badge badge-blue">{s.routeCount}</span></td>
                                            <td><span className="badge badge-green">active</span></td>
                                            <td className="cell-actions">
                                                <span
                                                    className="server-edit-icon"
                                                    title="Edit label"
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
                        <div className="card-title">Connection Error</div>
                        <div className="loading">{status.error}</div>
                    </div>
                )}
            </div>

            {editingServer && (
                <div className="modal-overlay" onClick={() => setEditingServer(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-title">Edit Label</div>
                        <div className="server-facts">
                            <div>
                                <span className="field-label">Server ID</span>
                                <div className="data-val mono">{editingServer.name}</div>
                            </div>
                            <div>
                                <span className="field-label">Listens on</span>
                                <div className="data-val mono">{editingServer.listen?.join(", ") || "no listeners"}</div>
                            </div>
                            <div>
                                <span className="field-label">Routes</span>
                                <div className="data-val mono">{editingServer.routeCount}</div>
                            </div>
                        </div>
                        <div className="field">
                            <label>Label</label>
                            <input value={editName} onChange={e => setEditName(e.target.value)} placeholder={`e.g. "HTTPS Sites" or "Internal Services"`} autoFocus onKeyDown={e => e.key === 'Enter' && saveName()} />
                        </div>
                        <div className="modal-hint">
                            Only shown in caddy/ui. Leave blank to remove it. To change the Server ID itself, set <code>name</code> in your Caddyfile's global <code>servers</code> option.
                        </div>
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

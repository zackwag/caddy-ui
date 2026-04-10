import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../utils/api.js";

export default function Dashboard({ status, toast, onUnauth, setTab, navigateToRoutes }) {
    const [names, setNames] = useState({});
    const [editingServer, setEditingServer] = useState(null);
    const [editName, setEditName] = useState("");
    const [health, setHealth] = useState(null);
    const [process, setProcess] = useState(null);

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

    const labelStyle = { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--muted)", letterSpacing: "1.2px", textTransform: "uppercase", marginBottom: 4, display: "block" };

    if (!status) return <div style={{ color: "var(--muted)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Loading...</div>;

    return (
        <>
            <div className="gap-16">
                <div className="grid-4">
                    <div className="card">
                        <div className="card-title">Status</div>
                        <div className="stat-val" style={{ color: status.online ? "var(--accent)" : "var(--danger)" }}>{status.online ? "ONLINE" : "OFFLINE"}</div>
                        <div className="stat-label">Caddy server</div>
                    </div>
                    <div className="card" style={{ cursor: "pointer" }} onClick={() => setTab("caddyfile")}>
                        <div className="card-title">Servers</div>
                        <div className="stat-val">{status.online ? status.serverCount : "—"}</div>
                        <div className="stat-label">Active server blocks</div>
                    </div>
                    <div className="card" style={{ cursor: "pointer" }} onClick={() => setTab("tls")}>
                        <div className="card-title">TLS</div>
                        <div className="stat-val" style={{ fontSize: 20, paddingTop: 6 }}>
                            {status.online ? <span className={`badge ${status.tlsEnabled ? "badge-green" : "badge-red"}`}>{status.tlsEnabled ? "ENABLED" : "DISABLED"}</span> : "—"}
                        </div>
                        <div className="stat-label">Certificate management</div>
                    </div>
                    <div className="card" style={{ cursor: "pointer" }} onClick={() => setTab("routes")}>
                        <div className="card-title">Upstreams</div>
                        <div className="stat-val" style={{ color: !health ? "var(--text)" : health.offline > 0 ? "var(--danger)" : "var(--accent)" }}>
                            {health ? `${health.online}/${health.total}` : "—"}
                        </div>
                        <div className="stat-label">{!health ? "Checking..." : health.offline > 0 ? `${health.offline} offline` : "All online"}</div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-title">Process</div>
                    {!process ? (
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--muted)" }}>Loading...</div>
                    ) : !process.ok ? (
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                            <span>Metrics not enabled</span>
                            <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setTab("metrics")}>Enable in Metrics →</button>
                        </div>
                    ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
                            {process.version && process.version !== 'unknown' && (
                                <div>
                                    <span style={labelStyle}>Version</span>
                                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "var(--text)" }}>{process.version}</div>
                                </div>
                            )}
                            <div>
                                <span style={labelStyle}>Uptime</span>
                                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "var(--accent)" }}>{process.uptime || "—"}</div>
                            </div>
                            <div>
                                <span style={labelStyle}>Heap</span>
                                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "var(--text)" }}>
                                    {process.memAlloc !== null ? `${process.memAlloc} MB` : "—"}
                                    {process.memSys !== null && <span style={{ color: "var(--muted)", fontSize: 11, marginLeft: 4 }}>/ {process.memSys} MB sys</span>}
                                </div>
                            </div>
                            <div>
                                <span style={labelStyle}>Last Reload</span>
                                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: process.lastReloadSuccess ? "var(--text)" : "var(--danger)" }}>
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
                            <div className="server-row" key={s.name} onClick={() => navigateToRoutes(s.name)} style={{ cursor: "pointer" }}>
                                <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                        <div className="server-name">{s.name}</div>
                                        {names[s.name] && <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: "var(--muted)" }}>·</span>}
                                        {names[s.name] && <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: "var(--text)" }}>{names[s.name]}</span>}
                                    </div>
                                    <div className="server-meta">{s.listen?.join(", ") || "no listeners"}</div>
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                    <span className="badge badge-blue">{s.routeCount} routes</span>
                                    <span className="badge badge-green">active</span>
                                    <span
                                        style={{ color: "var(--muted)", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}
                                        title="Edit display name"
                                        onClick={e => { e.stopPropagation(); openEdit(s); }}
                                    >✎</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!status.online && (
                    <div className="card" style={{ borderColor: "rgba(204,34,51,0.3)" }}>
                        <div className="card-title" style={{ color: "var(--danger)" }}>Connection Error</div>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--muted)" }}>{status.error}</div>
                    </div>
                )}
            </div>

            {editingServer && (
                <div className="modal-overlay" onClick={() => setEditingServer(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-title">Edit Server Block</div>
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                                <span className="badge badge-blue">{editingServer.name}</span>
                                <span className="badge badge-green">{editingServer.listen?.join(", ")}</span>
                                <span className="badge badge-blue">{editingServer.routeCount} routes</span>
                            </div>
                        </div>
                        <div className="field">
                            <label>Display Name</label>
                            <input value={editName} onChange={e => setEditName(e.target.value)} placeholder={`e.g. "Main Sites" or "Internal Services"`} autoFocus onKeyDown={e => e.key === 'Enter' && saveName()} />
                        </div>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--muted)", marginBottom: 16 }}>Leave blank to clear the name. This label appears next to the server key on the Dashboard.</div>
                        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                            <button className="btn btn-ghost" onClick={() => setEditingServer(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={saveName}>Save</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

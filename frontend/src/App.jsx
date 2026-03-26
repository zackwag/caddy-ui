import { useCallback, useEffect, useRef, useState } from "react";

const API = "/api";

const css = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #0d0f12;
    --surface:  #13161b;
    --border:   #1e2329;
    --border2:  #2a3040;
    --text:     #c9d1e0;
    --muted:    #586275;
    --accent:   #00e5a0;
    --accent2:  #0099ff;
    --danger:   #ff4d6a;
    --warn:     #ffb830;
    --mono:     'IBM Plex Mono', monospace;
    --sans:     'IBM Plex Sans', sans-serif;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-size: 14px;
    line-height: 1.6;
    min-height: 100vh;
  }

  .shell { display: flex; height: 100vh; overflow: hidden; }

  .sidebar {
    width: 220px;
    flex-shrink: 0;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 0;
    transition: transform 0.2s ease;
    z-index: 200;
  }

  .sidebar-logo {
    padding: 20px 20px 16px;
    border-bottom: 1px solid var(--border);
  }

  .logo-mark {
    font-family: var(--mono);
    font-size: 18px;
    font-weight: 600;
    color: var(--accent);
    letter-spacing: -0.5px;
  }

  .logo-sub {
    font-size: 10px;
    color: var(--muted);
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-top: 2px;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--mono);
    font-size: 10px;
    margin-top: 8px;
  }

  .status-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--muted);
  }
  .status-dot.online { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
  .status-dot.offline { background: var(--danger); }

  .nav { padding: 12px 0; flex: 1; }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 20px;
    cursor: pointer;
    color: var(--muted);
    font-size: 13px;
    font-weight: 400;
    border-left: 2px solid transparent;
    transition: all 0.15s;
    user-select: none;
  }

  .nav-item:hover { color: var(--text); background: rgba(255,255,255,0.03); }

  .nav-item.active {
    color: var(--accent);
    border-left-color: var(--accent);
    background: rgba(0,229,160,0.05);
  }

  .nav-icon { width: 16px; text-align: center; font-size: 14px; flex-shrink: 0; }

  .main {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .topbar {
    padding: 14px 28px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--surface);
    flex-shrink: 0;
    gap: 12px;
  }

  .topbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .page-title {
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    letter-spacing: 0.5px;
    white-space: nowrap;
  }

  .hamburger {
    display: none;
    background: transparent;
    border: 1px solid var(--border2);
    border-radius: 4px;
    color: var(--muted);
    cursor: pointer;
    padding: 6px 8px;
    font-size: 14px;
    flex-shrink: 0;
    line-height: 1;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 28px;
  }

  .sidebar-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    z-index: 150;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 20px;
  }

  .card-title {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 16px;
  }

  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .gap-16 { display: flex; flex-direction: column; gap: 16px; }

  .stat-val {
    font-family: var(--mono);
    font-size: 32px;
    font-weight: 600;
    color: var(--text);
    line-height: 1;
  }

  .stat-label {
    font-size: 12px;
    color: var(--muted);
    margin-top: 4px;
  }

  .server-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
    gap: 8px;
  }
  .server-row:last-child { border-bottom: none; }

  .server-name {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text);
  }

  .server-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }

  .badge {
    font-family: var(--mono);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 3px;
    font-weight: 500;
    white-space: nowrap;
  }
  .badge-green  { background: rgba(0,229,160,0.1);  color: var(--accent);  border: 1px solid rgba(0,229,160,0.2); }
  .badge-blue   { background: rgba(0,153,255,0.1);  color: var(--accent2); border: 1px solid rgba(0,153,255,0.2); }
  .badge-red    { background: rgba(255,77,106,0.1);  color: var(--danger);  border: 1px solid rgba(255,77,106,0.2); }
  .badge-yellow { background: rgba(255,184,48,0.1); color: var(--warn);    border: 1px solid rgba(255,184,48,0.2); }
  .badge-muted  { background: rgba(88,98,117,0.1);  color: var(--muted);   border: 1px solid rgba(88,98,117,0.2); }

  .editor-wrap {
    position: relative;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .editor-wrap textarea {
    width: 100%;
    min-height: 420px;
    background: #0a0c0f;
    color: #a8d8a8;
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.7;
    padding: 16px;
    border: none;
    resize: vertical;
    outline: none;
    caret-color: var(--accent);
  }

  .editor-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: #0a0c0f;
    border-top: 1px solid var(--border);
    flex-wrap: wrap;
    gap: 8px;
  }

  .editor-hint { font-family: var(--mono); font-size: 10px; color: var(--muted); }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.15s;
    letter-spacing: 0.3px;
    white-space: nowrap;
  }

  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: #000; }
  .btn-primary:hover:not(:disabled) { background: #00ffb3; }
  .btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border2); }
  .btn-ghost:hover:not(:disabled) { color: var(--text); border-color: var(--muted); }
  .btn-danger { background: transparent; color: var(--danger); border: 1px solid rgba(255,77,106,0.3); }
  .btn-danger:hover:not(:disabled) { background: rgba(255,77,106,0.1); }

  .btn-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

  .toast-wrap {
    position: fixed;
    bottom: 24px; right: 24px;
    display: flex; flex-direction: column;
    gap: 8px; z-index: 1000;
    max-width: calc(100vw - 48px);
  }

  .toast {
    font-family: var(--mono);
    font-size: 12px;
    padding: 10px 16px;
    border-radius: 4px;
    border-left: 3px solid;
    animation: slideIn 0.2s ease;
    max-width: 340px;
  }

  .toast-success { background: #0a1a12; border-color: var(--accent); color: var(--accent); }
  .toast-error   { background: #1a0a0e; border-color: var(--danger); color: var(--danger); }
  .toast-info    { background: #0a1020; border-color: var(--accent2); color: var(--accent2); }

  @keyframes slideIn {
    from { transform: translateX(20px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }

  .table-wrap { overflow-x: auto; }

  .table { width: 100%; border-collapse: collapse; min-width: 500px; }
  .table th {
    text-align: left;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--muted);
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .table td {
    padding: 11px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
    vertical-align: middle;
  }
  .table tr:last-child td { border-bottom: none; }
  .table tr:hover td { background: rgba(255,255,255,0.02); }

  .mono { font-family: var(--mono); font-size: 12px; }

  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center;
    z-index: 500;
    animation: fadeIn 0.15s ease;
    padding: 16px;
  }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .modal {
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: 8px;
    padding: 24px;
    width: 460px;
    max-width: 100%;
  }

  .modal-title {
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 20px;
  }

  .field { margin-bottom: 14px; }
  .field label {
    display: block;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .field input {
    width: 100%;
    background: #0a0c0f;
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 8px 12px;
    color: var(--text);
    font-family: var(--mono);
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
  }
  .field input:focus { border-color: var(--accent); }

  .log-wrap {
    background: #0a0c0f;
    border: 1px solid var(--border);
    border-radius: 6px;
    height: 420px;
    overflow-y: auto;
    padding: 12px;
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1.6;
  }

  .log-line { padding: 1px 0; color: var(--muted); word-break: break-all; }
  .log-line:hover { color: var(--text); background: rgba(255,255,255,0.02); }
  .log-line.err { color: #ff6b6b; }
  .log-line.warn { color: var(--warn); }

  .log-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .live-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

  /* ── expiry bar ── */
  .expiry-bar {
    height: 3px;
    border-radius: 2px;
    background: var(--border);
    margin-top: 4px;
    overflow: hidden;
    width: 80px;
  }
  .expiry-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s;
  }

  @media (max-width: 768px) {
    .hamburger { display: flex; }
    .sidebar {
      position: fixed;
      top: 0; left: 0; bottom: 0;
      transform: translateX(-100%);
    }
    .sidebar.open { transform: translateX(0); box-shadow: 4px 0 24px rgba(0,0,0,0.4); }
    .sidebar-overlay.open { display: block; }
    .content { padding: 16px; }
    .topbar { padding: 12px 16px; }
    .grid-3 { grid-template-columns: 1fr; }
    .grid-4 { grid-template-columns: 1fr 1fr; }
    .editor-wrap textarea { min-height: 300px; font-size: 12px; }
    .editor-toolbar { flex-direction: column; align-items: flex-start; }
    .log-wrap { height: 340px; }
  }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function useToast() {
    const [toasts, setToasts] = useState([]);
    const add = useCallback((msg, type = "info") => {
        const id = Date.now();
        setToasts(t => [...t, { id, msg, type }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
    }, []);
    return { toasts, success: m => add(m, "success"), error: m => add(m, "error"), info: m => add(m, "info") };
}

async function apiFetch(path, opts = {}) {
    const res = await fetch(`${API}${path}`, opts);
    if (!res.ok) {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
            const body = await res.json();
            if (body.errors?.length) throw new Error(body.errors.join('\n'));
            throw new Error(body.error || res.statusText);
        }
        throw new Error(res.statusText);
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
}

function Toasts({ toasts }) {
    return (
        <div className="toast-wrap">
            {toasts.map(t => (
                <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
            ))}
        </div>
    );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard({ status, toast }) {
    const [names, setNames] = useState({});
    const [editingServer, setEditingServer] = useState(null);
    const [editName, setEditName] = useState("");

    useEffect(() => {
        apiFetch("/server-names").then(setNames).catch(() => { });
    }, []);

    const openEdit = (server) => {
        setEditingServer(server);
        setEditName(names[server.name] || "");
    };

    const saveName = async () => {
        try {
            if (editName.trim()) {
                await apiFetch(`/server-names/${editingServer.name}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: editName }),
                });
                setNames(n => ({ ...n, [editingServer.name]: editName.trim() }));
                toast.success("Server name saved");
            } else {
                await apiFetch(`/server-names/${editingServer.name}`, { method: "DELETE" });
                setNames(n => { const x = { ...n }; delete x[editingServer.name]; return x; });
                toast.success("Server name cleared");
            }
            setEditingServer(null);
        } catch (e) {
            toast.error(e.message);
        }
    };

    if (!status) return <div style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 12 }}>Loading...</div>;

    return (
        <>
            <div className="gap-16">
                <div className="grid-3">
                    <div className="card">
                        <div className="card-title">Status</div>
                        <div className="stat-val" style={{ color: status.online ? "var(--accent)" : "var(--danger)" }}>
                            {status.online ? "ONLINE" : "OFFLINE"}
                        </div>
                        <div className="stat-label">Caddy server</div>
                    </div>
                    <div className="card">
                        <div className="card-title">Servers</div>
                        <div className="stat-val">{status.online ? status.serverCount : "—"}</div>
                        <div className="stat-label">Active server blocks</div>
                    </div>
                    <div className="card">
                        <div className="card-title">TLS</div>
                        <div className="stat-val" style={{ fontSize: 20, paddingTop: 6 }}>
                            {status.online
                                ? <span className={`badge ${status.tlsEnabled ? "badge-green" : "badge-red"}`}>{status.tlsEnabled ? "ENABLED" : "DISABLED"}</span>
                                : "—"}
                        </div>
                        <div className="stat-label">Certificate management</div>
                    </div>
                </div>

                {status.online && status.servers?.length > 0 && (
                    <div className="card">
                        <div className="card-title">Server Blocks</div>
                        {status.servers.map(s => (
                            <div className="server-row" key={s.name} onClick={() => openEdit(s)} style={{ cursor: "pointer" }}>
                                <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                        <div className="server-name">{s.name}</div>
                                        {names[s.name] && (
                                            <span style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--text)" }}>
                                                — {names[s.name]}
                                            </span>
                                        )}
                                    </div>
                                    <div className="server-meta">{s.listen?.join(", ") || "no listeners"}</div>
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                    <span className="badge badge-blue">{s.routeCount} routes</span>
                                    <span className="badge badge-green">active</span>
                                    <span style={{ color: "var(--muted)", fontSize: 11, fontFamily: "var(--mono)" }}>✎</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!status.online && (
                    <div className="card" style={{ borderColor: "rgba(255,77,106,0.3)" }}>
                        <div className="card-title" style={{ color: "var(--danger)" }}>Connection Error</div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }}>{status.error}</div>
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
                            <input
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                placeholder={`e.g. "Main Sites" or "Internal Services"`}
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && saveName()}
                            />
                        </div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted)", marginBottom: 16 }}>
                            Leave blank to clear the name.
                        </div>
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

// ── Caddyfile Editor ──────────────────────────────────────────────────────────

function CaddyfileEditor({ toast }) {
    const [content, setContent] = useState("");
    const [original, setOriginal] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [validating, setValidating] = useState(false);
    const [runFmt, setRunFmt] = useState(true);
    const [runSort, setRunSort] = useState(true);

    useEffect(() => {
        apiFetch("/caddyfile")
            .then(t => { setContent(t); setOriginal(t); })
            .catch(e => toast.error(e.message))
            .finally(() => setLoading(false));
    }, []);

    const validate = async () => {
        setValidating(true);
        try {
            const result = await apiFetch("/caddyfile/validate", {
                method: "POST",
                headers: { "Content-Type": "text/plain" },
                body: content,
            });
            if (result.warnings?.length) {
                result.warnings.forEach(w => toast.info(w));
            } else {
                toast.success("Caddyfile is valid");
            }
        } catch (e) {
            toast.error(e.message);
        } finally {
            setValidating(false);
        }
    };

    const save = async () => {
        setSaving(true);
        try {
            await apiFetch(`/caddyfile?fmt=${runFmt}&sort=${runSort}`, {
                method: "PUT",
                headers: { "Content-Type": "text/plain" },
                body: content,
            });
            const fresh = await apiFetch("/caddyfile");
            setContent(fresh);
            setOriginal(fresh);
            toast.success("Caddyfile saved and reloaded");
        } catch (e) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    };

    const reload = async () => {
        try {
            await apiFetch("/caddyfile/reload", { method: "POST" });
            toast.success("Caddy reloaded from disk");
        } catch (e) {
            toast.error(e.message);
        }
    };

    const isDirty = content !== original;

    if (loading) return <div style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 12 }}>Loading Caddyfile...</div>;

    return (
        <div className="gap-16">
            <div className="editor-wrap">
                <textarea
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    spellCheck={false}
                    placeholder="# Caddyfile"
                />
                <div className="editor-toolbar">
                    <div className="btn-row">
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)", cursor: "pointer" }}>
                            <input type="checkbox" checked={runFmt} onChange={e => setRunFmt(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
                            caddy fmt
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)", cursor: "pointer" }}>
                            <input type="checkbox" checked={runSort} onChange={e => setRunSort(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
                            sort entries
                        </label>
                    </div>
                    <div className="btn-row">
                        <span className="editor-hint">{isDirty ? "● unsaved changes" : "✓ up to date"}</span>
                        <button className="btn btn-ghost" onClick={validate} disabled={validating}>
                            {validating ? "Validating..." : "✓ Validate"}
                        </button>
                        <button className="btn btn-ghost" onClick={reload}>↺ Reload</button>
                        <button className="btn btn-primary" onClick={save} disabled={saving || !isDirty}>
                            {saving ? "Saving..." : "↑ Save"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Routes ────────────────────────────────────────────────────────────────────

function RouteModal({ route, onSave, onClose }) {
    const [form, setForm] = useState(route || { domain: "", upstream: "", stripPrefix: "" });
    const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">{route ? "Edit Route" : "New Reverse Proxy Route"}</div>
                <div className="field">
                    <label>Domain</label>
                    <input value={form.domain} onChange={set("domain")} placeholder="app.example.com" />
                </div>
                <div className="field">
                    <label>Upstream</label>
                    <input value={form.upstream} onChange={set("upstream")} placeholder="192.168.4.88:8080" />
                </div>
                <div className="field">
                    <label>Strip Prefix (optional)</label>
                    <input value={form.stripPrefix} onChange={set("stripPrefix")} placeholder="/api" />
                </div>
                <div className="btn-row" style={{ marginTop: 20, justifyContent: "flex-end" }}>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.domain || !form.upstream}>
                        {route ? "Update" : "Add Route"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function RoutesManager({ toast }) {
    const [routes, setRoutes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modal, setModal] = useState(null);
    const [sortCol, setSortCol] = useState("domain");
    const [sortDir, setSortDir] = useState("asc");

    const load = () => {
        apiFetch("/routes")
            .then(setRoutes)
            .catch(e => toast.error(e.message))
            .finally(() => setLoading(false));
    };

    useEffect(load, []);

    const addRoute = async (form) => {
        try {
            await apiFetch("/routes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });
            toast.success(`Route for ${form.domain} added`);
            setModal(null);
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const deleteRoute = async (id) => {
        if (!confirm("Delete this route?")) return;
        try {
            await apiFetch(`/routes/${id}`, { method: "DELETE" });
            toast.success("Route removed");
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const getHost = (route) => {
        const hostMatcher = route.match?.find(m => m.host);
        return hostMatcher?.host?.join(", ") || "—";
    };

    const getUpstream = (route) => {
        const subroute = route.handle?.find(h => h.handler === "subroute");
        const innerRoutes = subroute?.routes ?? [];
        for (const r of innerRoutes) {
            const rp = r.handle?.find(h => h.handler === "reverse_proxy");
            if (rp) return rp.upstreams?.map(u => u.dial).join(", ") || "—";
        }
        const flat = route.handle?.find(h => h.handler === "reverse_proxy");
        return flat?.upstreams?.map(u => u.dial).join(", ") || "—";
    };

    const handleSort = (col) => {
        if (sortCol === col) {
            setSortDir(d => d === "asc" ? "desc" : "asc");
        } else {
            setSortCol(col);
            setSortDir("asc");
        }
    };

    const sorted = [...routes].sort((a, b) => {
        let valA, valB;
        if (sortCol === "domain") { valA = getHost(a); valB = getHost(b); }
        else if (sortCol === "upstream") { valA = getUpstream(a); valB = getUpstream(b); }
        else { valA = a._server || ""; valB = b._server || ""; }
        const cmp = valA.localeCompare(valB);
        return sortDir === "asc" ? cmp : -cmp;
    });

    const SortIcon = ({ col }) => {
        if (sortCol !== col) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
        return <span style={{ marginLeft: 4, color: "var(--accent)" }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
    };

    if (loading) return <div style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 12 }}>Loading routes...</div>;

    return (
        <>
            <div className="gap-16">
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button className="btn btn-primary" onClick={() => setModal("new")}>+ Add Route</button>
                </div>
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                    {routes.length === 0 ? (
                        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 12 }}>
                            No routes configured
                        </div>
                    ) : (
                        <div className="table-wrap">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th onClick={() => handleSort("domain")} style={{ cursor: "pointer", userSelect: "none" }}>
                                            Domain <SortIcon col="domain" />
                                        </th>
                                        <th onClick={() => handleSort("upstream")} style={{ cursor: "pointer", userSelect: "none" }}>
                                            Upstream <SortIcon col="upstream" />
                                        </th>
                                        <th onClick={() => handleSort("server")} style={{ cursor: "pointer", userSelect: "none" }}>
                                            Server <SortIcon col="server" />
                                        </th>
                                        <th>ID</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.map((r, i) => (
                                        <tr key={r["@id"] || i}>
                                            <td className="mono">{getHost(r)}</td>
                                            <td className="mono" style={{ color: "var(--accent2)" }}>{getUpstream(r)}</td>
                                            <td className="mono" style={{ color: "var(--muted)", fontSize: 10 }}>{r._server || "—"}</td>
                                            <td className="mono" style={{ color: "var(--muted)", fontSize: 10 }}>{r["@id"] || "—"}</td>
                                            <td style={{ width: 80, textAlign: "right" }}>
                                                {r["@id"] && (
                                                    <button className="btn btn-danger" style={{ padding: "4px 10px" }} onClick={() => deleteRoute(r["@id"])}>✕</button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
            {modal && (
                <RouteModal
                    route={modal === "new" ? null : modal}
                    onSave={addRoute}
                    onClose={() => setModal(null)}
                />
            )}
        </>
    );
}

// ── TLS ───────────────────────────────────────────────────────────────────────

function TLSViewer({ toast }) {
    const [certs, setCerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");

    const load = () => {
        setLoading(true);
        apiFetch("/tls")
            .then(setCerts)
            .catch(e => toast.error(e.message))
            .finally(() => setLoading(false));
    };

    useEffect(load, []);

    const deleteCert = async (cert) => {
        if (!confirm(`Delete orphaned cert for ${cert.domain}?`)) return;
        try {
            await apiFetch(`/tls/${cert.issuerDir}/${cert.domain}`, { method: "DELETE" });
            toast.success(`Deleted cert for ${cert.domain}`);
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const summary = {
        total: certs.filter(c => c.status !== 'orphaned').length,
        valid: certs.filter(c => c.status === 'valid').length,
        expiring: certs.filter(c => c.status === 'expiring').length,
        expired: certs.filter(c => c.status === 'expired').length,
        orphaned: certs.filter(c => c.status === 'orphaned').length,
    };

    const filtered = filter === "all" ? certs.filter(c => c.status !== 'orphaned') : certs.filter(c => c.status === filter);

    const statusBadge = (cert) => {
        if (cert.status === 'expired') return <span className="badge badge-red">EXPIRED</span>;
        if (cert.status === 'expiring') return <span className="badge badge-yellow">EXPIRING</span>;
        if (cert.status === 'orphaned') return <span className="badge badge-muted">ORPHANED</span>;
        return <span className="badge badge-green">VALID</span>;
    };

    const expiryBar = (cert) => {
        if (cert.isInternal) return null;
        const max = 90;
        const pct = Math.max(0, Math.min(100, (cert.daysRemaining / max) * 100));
        const color = cert.daysRemaining < 0 ? 'var(--danger)'
            : cert.daysRemaining < 14 ? 'var(--warn)'
                : 'var(--accent)';
        return (
            <div className="expiry-bar">
                <div className="expiry-bar-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
        );
    };

    const formatDate = (dateStr) => {
        try {
            return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
            return dateStr;
        }
    };

    if (loading) return <div style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 12 }}>Loading certificates...</div>;

    return (
        <div className="gap-16">

            {/* Summary cards */}
            <div className="grid-4">
                <div className="card" style={{ cursor: "pointer", borderColor: filter === "all" ? "var(--accent)" : "var(--border)" }} onClick={() => setFilter("all")}>
                    <div className="card-title">Total</div>
                    <div className="stat-val">{summary.total}</div>
                    <div className="stat-label">Managed certs</div>
                </div>
                <div className="card" style={{ cursor: "pointer", borderColor: filter === "valid" ? "var(--accent)" : "var(--border)" }} onClick={() => setFilter("valid")}>
                    <div className="card-title">Valid</div>
                    <div className="stat-val" style={{ color: "var(--accent)" }}>{summary.valid}</div>
                    <div className="stat-label">Healthy</div>
                </div>
                <div className="card" style={{ cursor: "pointer", borderColor: filter === "expiring" ? "var(--accent)" : "var(--border)" }} onClick={() => setFilter("expiring")}>
                    <div className="card-title">Expiring</div>
                    <div className="stat-val" style={{ color: summary.expiring > 0 ? "var(--warn)" : "var(--text)" }}>{summary.expiring}</div>
                    <div className="stat-label">Within 14 days</div>
                </div>
                <div className="card" style={{ cursor: "pointer", borderColor: filter === "expired" ? "var(--accent)" : "var(--border)" }} onClick={() => setFilter("expired")}>
                    <div className="card-title">Expired</div>
                    <div className="stat-val" style={{ color: summary.expired > 0 ? "var(--danger)" : "var(--text)" }}>{summary.expired}</div>
                    <div className="stat-label">Needs renewal</div>
                </div>
            </div>

            {/* Cert table */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--muted)" }}>
                        Certificates {filter !== "all" && `— ${filter}`}
                    </span>
                    <div className="btn-row">
                        {summary.orphaned > 0 && (
                            <span
                                style={{ fontFamily: "var(--mono)", fontSize: 11, color: filter === "orphaned" ? "var(--accent)" : "var(--muted)", cursor: "pointer" }}
                                onClick={() => setFilter(filter === "orphaned" ? "all" : "orphaned")}
                            >
                                {summary.orphaned} orphaned
                            </span>
                        )}
                        <button className="btn btn-ghost" onClick={load} style={{ fontSize: 11 }}>↺ Refresh</button>
                    </div>
                </div>
                {filtered.length === 0 ? (
                    <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 12 }}>
                        No certificates in this category
                    </div>
                ) : (
                    <div className="table-wrap">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Domain</th>
                                    <th>Issuer</th>
                                    <th>Expires</th>
                                    <th>Days</th>
                                    <th>Status</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((cert, i) => (
                                    <tr key={i} style={{ opacity: cert.status === 'orphaned' ? 0.6 : 1 }}>
                                        <td className="mono">{cert.domain}</td>
                                        <td>
                                            <span className={`badge ${cert.issuer === 'acme' ? 'badge-blue' : 'badge-muted'}`}>
                                                {cert.issuer === 'acme' ? "Let's Encrypt" : "Internal"}
                                            </span>
                                        </td>
                                        <td>
                                            <div style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{formatDate(cert.validTo)}</div>
                                            {expiryBar(cert)}
                                        </td>
                                        <td className="mono" style={{
                                            color: cert.daysRemaining < 0 ? "var(--danger)"
                                                : cert.daysRemaining < 14 ? "var(--warn)"
                                                    : "var(--muted)"
                                        }}>
                                            {cert.isInternal ? "auto" : `${cert.daysRemaining}d`}
                                        </td>
                                        <td>{statusBadge(cert)}</td>
                                        <td style={{ width: 60, textAlign: "right" }}>
                                            {cert.status === 'orphaned' && (
                                                <button
                                                    className="btn btn-danger"
                                                    style={{ padding: "4px 10px" }}
                                                    onClick={() => deleteCert(cert)}
                                                >
                                                    ✕
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {summary.orphaned > 0 && filter !== "orphaned" && (
                <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
                    {summary.orphaned} orphaned cert{summary.orphaned > 1 ? "s" : ""} hidden — stale certs for domains no longer in your Caddyfile.
                    <span style={{ color: "var(--accent2)", cursor: "pointer", marginLeft: 6 }} onClick={() => setFilter("orphaned")}>Show</span>
                </div>
            )}
        </div>
    );
}

// ── Logs ──────────────────────────────────────────────────────────────────────

function LogsViewer({ toast }) {
    const [lines, setLines] = useState([]);
    const [live, setLive] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [logConfig, setLogConfig] = useState(null);
    const [configDirty, setConfigDirty] = useState(false);
    const [savingConfig, setSavingConfig] = useState(false);
    const bottomRef = useRef(null);
    const esRef = useRef(null);

    useEffect(() => {
        apiFetch("/logs").then(data => setLines(data.lines || [])).catch(e => toast.error(e.message));
        apiFetch("/logs/config").then(cfg => setLogConfig(cfg)).catch(e => toast.error(e.message));
    }, []);

    useEffect(() => {
        if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }, [lines]);

    const toggleLive = () => {
        if (live) {
            esRef.current?.close();
            esRef.current = null;
            setLive(false);
        } else {
            const es = new EventSource(`${API}/logs/stream`);
            es.onmessage = e => {
                const data = JSON.parse(e.data);
                if (data.line) setLines(l => [...l.slice(-500), data.line]);
            };
            esRef.current = es;
            setLive(true);
        }
    };

    useEffect(() => () => esRef.current?.close(), []);

    const classify = (line) => {
        const l = line.toLowerCase();
        if (l.includes('"level":"error"') || l.includes('error')) return 'err';
        if (l.includes('"level":"warn"') || l.includes('warn')) return 'warn';
        return '';
    };

    const updateConfig = (key, value) => {
        setLogConfig(c => ({ ...c, [key]: value }));
        setConfigDirty(true);
    };

    const saveConfig = async () => {
        setSavingConfig(true);
        try {
            await apiFetch("/logs/config", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(logConfig),
            });
            toast.success("Log config saved and reloaded");
            setConfigDirty(false);
        } catch (e) {
            toast.error(e.message);
        } finally {
            setSavingConfig(false);
        }
    };

    const selectStyle = {
        background: "#0a0c0f", border: "1px solid var(--border2)", borderRadius: 4,
        padding: "6px 10px", color: "var(--text)", fontFamily: "var(--mono)",
        fontSize: 12, outline: "none", cursor: "pointer", width: "100%",
    };

    const inputStyle = {
        background: "#0a0c0f", border: "1px solid var(--border2)", borderRadius: 4,
        padding: "6px 10px", color: "var(--text)", fontFamily: "var(--mono)",
        fontSize: 12, outline: "none", width: "100%",
    };

    const labelStyle = {
        fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "1.2px",
        textTransform: "uppercase", color: "var(--muted)", marginBottom: 5, display: "block",
    };

    return (
        <div className="gap-16">
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div
                    onClick={() => setConfigOpen(o => !o)}
                    style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none", borderBottom: configOpen ? "1px solid var(--border)" : "none" }}
                >
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--muted)" }}>
                        Log Configuration
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {logConfig && (
                            <span className={`badge ${logConfig.enabled ? "badge-green" : "badge-red"}`}>
                                {logConfig.enabled ? "ENABLED" : "DISABLED"}
                            </span>
                        )}
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>{configOpen ? "▲" : "▼"}</span>
                    </div>
                </div>

                {configOpen && logConfig && (
                    <div style={{ padding: 16 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16, marginBottom: 16 }}>
                            <div>
                                <span style={labelStyle}>Logging</span>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontFamily: "var(--mono)", fontSize: 12, color: "var(--text)" }}>
                                    <input type="checkbox" checked={logConfig.enabled} onChange={e => updateConfig("enabled", e.target.checked)} style={{ accentColor: "var(--accent)", width: 14, height: 14 }} />
                                    {logConfig.enabled ? "Enabled" : "Disabled"}
                                </label>
                            </div>
                            <div>
                                <span style={labelStyle}>Format</span>
                                <select value={logConfig.format} onChange={e => updateConfig("format", e.target.value)} style={selectStyle} disabled={!logConfig.enabled}>
                                    <option value="json">json</option>
                                    <option value="console">console</option>
                                </select>
                            </div>
                            <div>
                                <span style={labelStyle}>Level</span>
                                <select value={logConfig.level} onChange={e => updateConfig("level", e.target.value)} style={selectStyle} disabled={!logConfig.enabled}>
                                    <option value="DEBUG">DEBUG</option>
                                    <option value="INFO">INFO</option>
                                    <option value="WARN">WARN</option>
                                    <option value="ERROR">ERROR</option>
                                </select>
                            </div>
                            <div style={{ gridColumn: "1 / -1" }}>
                                <span style={labelStyle}>Log File Path</span>
                                <input value={logConfig.path} onChange={e => updateConfig("path", e.target.value)} style={inputStyle} disabled={!logConfig.enabled} />
                            </div>
                            <div>
                                <span style={labelStyle}>Roll Size</span>
                                <input value={logConfig.rollSize} onChange={e => updateConfig("rollSize", e.target.value)} style={inputStyle} placeholder="50mb" disabled={!logConfig.enabled} />
                            </div>
                            <div>
                                <span style={labelStyle}>Roll Keep</span>
                                <input type="number" value={logConfig.rollKeep} onChange={e => updateConfig("rollKeep", parseInt(e.target.value))} style={inputStyle} min={1} max={20} disabled={!logConfig.enabled} />
                            </div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <button className="btn btn-primary" onClick={saveConfig} disabled={savingConfig || !configDirty}>
                                {savingConfig ? "Saving..." : "↑ Save Config"}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="log-toolbar">
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>{lines.length} lines loaded</span>
                <div className="btn-row">
                    {live && <div className="live-dot" />}
                    <button className={`btn ${live ? "btn-danger" : "btn-ghost"}`} onClick={toggleLive}>
                        {live ? "■ Stop" : "▶ Live"}
                    </button>
                    <button className="btn btn-ghost" onClick={() => apiFetch("/logs").then(d => setLines(d.lines || []))}>
                        ↺ Refresh
                    </button>
                </div>
            </div>
            <div className="log-wrap">
                {lines.map((line, i) => (
                    <div key={i} className={`log-line ${classify(line)}`}>{line}</div>
                ))}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}

// ── Nav ───────────────────────────────────────────────────────────────────────

const NAV = [
    { id: "dashboard", label: "Dashboard", icon: "◈" },
    { id: "caddyfile", label: "Caddyfile", icon: "⌗" },
    { id: "routes", label: "Routes", icon: "⇌" },
    { id: "tls", label: "TLS", icon: "⊕" },
    { id: "logs", label: "Logs", icon: "≡" },
];

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
    const [tab, setTab] = useState("dashboard");
    const [status, setStatus] = useState(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const toast = useToast();

    const fetchStatus = useCallback(() => {
        apiFetch("/status")
            .then(setStatus)
            .catch(() => setStatus({ online: false, error: "Could not reach backend" }));
    }, []);

    useEffect(() => {
        fetchStatus();
        const t = setInterval(fetchStatus, 15000);
        return () => clearInterval(t);
    }, [fetchStatus]);

    const titles = {
        dashboard: "Dashboard",
        caddyfile: "Caddyfile Editor",
        routes: "Route Manager",
        tls: "TLS Certificates",
        logs: "Access Logs",
    };

    const handleNavClick = (id) => {
        setTab(id);
        setSidebarOpen(false);
    };

    return (
        <>
            <style>{css}</style>
            <div className="shell">
                <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />

                <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
                    <div className="sidebar-logo">
                        <div className="logo-mark">caddy/ui</div>
                        <div className="logo-sub">Server Manager</div>
                        <div className="status-pill">
                            <div className={`status-dot ${status ? (status.online ? "online" : "offline") : ""}`} />
                            <span style={{ color: "var(--muted)" }}>
                                {status ? (status.online ? "connected" : "unreachable") : "checking..."}
                            </span>
                        </div>
                    </div>
                    <nav className="nav">
                        {NAV.map(n => (
                            <div key={n.id} className={`nav-item ${tab === n.id ? "active" : ""}`} onClick={() => handleNavClick(n.id)}>
                                <span className="nav-icon">{n.icon}</span>
                                {n.label}
                            </div>
                        ))}
                    </nav>
                </aside>

                <div className="main">
                    <div className="topbar">
                        <div className="topbar-left">
                            <button className="hamburger" onClick={() => setSidebarOpen(o => !o)}>☰</button>
                            <span className="page-title">{titles[tab]}</span>
                        </div>
                        <button className="btn btn-ghost" onClick={fetchStatus} style={{ fontSize: 11 }}>↺ Refresh</button>
                    </div>
                    <div className="content">
                        {tab === "dashboard" && <Dashboard status={status} toast={toast} />}
                        {tab === "caddyfile" && <CaddyfileEditor toast={toast} />}
                        {tab === "routes" && <RoutesManager toast={toast} />}
                        {tab === "tls" && <TLSViewer toast={toast} />}
                        {tab === "logs" && <LogsViewer toast={toast} />}
                    </div>
                </div>
            </div>
            <Toasts toasts={toast.toasts} />
        </>
    );
}

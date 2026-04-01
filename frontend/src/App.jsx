import { useCallback, useEffect, useRef, useState } from "react";

const API = "/api";

const darkTheme = `
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
  --editor-bg:    #0a0c0f;
  --editor-gutter:#0d0f12;
  --editor-text:  #a8d8a8;
  --log-bg:       #0a0c0f;
`;

const lightTheme = `
  --bg:       #f5f0eb;
  --surface:  #faf7f4;
  --border:   #e0d8d0;
  --border2:  #ccc4ba;
  --text:     #2c2825;
  --muted:    #8a7f75;
  --accent:   #00956b;
  --accent2:  #0077cc;
  --danger:   #cc2233;
  --warn:     #b36000;
  --editor-bg:    #f0ebe4;
  --editor-gutter:#e8e2db;
  --editor-text:  #3a5c3a;
  --log-bg:       #f0ebe4;
`;

const css = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    ${darkTheme}
    --mono: 'IBM Plex Mono', monospace;
    --sans: 'IBM Plex Sans', sans-serif;
  }
  :root.light {
    ${lightTheme}
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 14px;
    line-height: 1.6;
    min-height: 100vh;
    transition: background 0.2s, color 0.2s;
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
    transition: transform 0.2s ease, background 0.2s;
    z-index: 200;
  }

  .sidebar-logo {
    padding: 20px 20px 16px;
    border-bottom: 1px solid var(--border);
  }

  .logo-mark {
    font-family: 'IBM Plex Mono', monospace;
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
    font-family: 'IBM Plex Mono', monospace;
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

  .nav-item:hover { color: var(--text); background: rgba(0,0,0,0.04); }

  .nav-item.active {
    color: var(--accent);
    border-left-color: var(--accent);
    background: rgba(0,149,107,0.07);
  }

  .nav-icon { width: 16px; text-align: center; font-size: 14px; flex-shrink: 0; }

  .nav-footer {
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }

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
    transition: background 0.2s;
  }

  .topbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .page-title {
    font-family: 'IBM Plex Mono', monospace;
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
    transition: background 0.2s;
  }

  .card-title {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 16px;
  }

  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .gap-16 { display: flex; flex-direction: column; gap: 16px; }

  .stat-val {
    font-family: 'IBM Plex Mono', monospace;
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
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: var(--text);
  }

  .server-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }

  .badge {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 3px;
    font-weight: 500;
    white-space: nowrap;
  }
  .badge-green  { background: rgba(0,149,107,0.1);  color: var(--accent);  border: 1px solid rgba(0,149,107,0.25); }
  .badge-blue   { background: rgba(0,119,204,0.1);  color: var(--accent2); border: 1px solid rgba(0,119,204,0.25); }
  .badge-red    { background: rgba(204,34,51,0.1);  color: var(--danger);  border: 1px solid rgba(204,34,51,0.25); }
  .badge-yellow { background: rgba(179,96,0,0.1);   color: var(--warn);    border: 1px solid rgba(179,96,0,0.25); }
  .badge-muted  { background: rgba(138,127,117,0.1);color: var(--muted);   border: 1px solid rgba(138,127,117,0.25); }

  .editor-wrap {
    position: relative;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .editor-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--editor-bg);
    border-top: 1px solid var(--border);
    flex-wrap: wrap;
    gap: 8px;
  }

  .editor-hint { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--muted); }

  .cm-editor { min-height: 420px; font-family: 'IBM Plex Mono', monospace !important; }
  .cm-editor.cm-focused { outline: none; }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: 4px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.15s;
    letter-spacing: 0.3px;
    white-space: nowrap;
  }

  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
  .btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border2); }
  .btn-ghost:hover:not(:disabled) { color: var(--text); border-color: var(--muted); }
  .btn-danger { background: transparent; color: var(--danger); border: 1px solid rgba(204,34,51,0.3); }
  .btn-danger:hover:not(:disabled) { background: rgba(204,34,51,0.08); }

  .btn-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

  /* Theme toggle */
  .theme-toggle {
    background: transparent;
    border: 1px solid var(--border2);
    border-radius: 4px;
    color: var(--muted);
    cursor: pointer;
    padding: 6px 10px;
    font-size: 14px;
    line-height: 1;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .theme-toggle:hover { color: var(--text); border-color: var(--muted); }

  .toast-wrap {
    position: fixed;
    bottom: 24px; right: 24px;
    display: flex; flex-direction: column;
    gap: 8px; z-index: 1000;
    max-width: calc(100vw - 48px);
  }

  .toast {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    padding: 10px 16px;
    border-radius: 4px;
    border-left: 3px solid;
    animation: slideIn 0.2s ease;
    max-width: 340px;
  }

  .toast-success { background: rgba(0,149,107,0.12); border-color: var(--accent); color: var(--accent); }
  .toast-error   { background: rgba(204,34,51,0.12);  border-color: var(--danger); color: var(--danger); }
  .toast-info    { background: rgba(0,119,204,0.12);  border-color: var(--accent2); color: var(--accent2); }

  @keyframes slideIn {
    from { transform: translateX(20px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }

  .table-wrap { overflow-x: auto; }

  .table { width: 100%; border-collapse: collapse; min-width: 500px; }
  .table th {
    text-align: left;
    font-family: 'IBM Plex Mono', monospace;
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
  .table tr:hover td { background: rgba(0,0,0,0.03); }

  .mono { font-family: 'IBM Plex Mono', monospace; font-size: 12px; }

  a.route-link {
    color: inherit;
    text-decoration: none;
    border-bottom: 1px dashed var(--border2);
    transition: color 0.15s, border-color 0.15s;
  }
  a.route-link:hover { color: var(--accent) !important; border-color: var(--accent); }
  a.route-link.upstream { color: var(--accent2); }

  .search-input {
    background: var(--editor-bg);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 7px 12px;
    color: var(--text);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    outline: none;
    width: 220px;
    transition: border-color 0.15s;
  }
  .search-input:focus { border-color: var(--accent); }
  .search-input::placeholder { color: var(--muted); }

  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
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
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 20px;
  }

  .field { margin-bottom: 14px; }
  .field label {
    display: block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .field input {
    width: 100%;
    background: var(--editor-bg);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 8px 12px;
    color: var(--text);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
  }
  .field input:focus { border-color: var(--accent); }
  .field input:disabled { opacity: 0.4; cursor: not-allowed; }

  .log-wrap {
    background: var(--log-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    height: 420px;
    overflow-y: auto;
    padding: 12px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    line-height: 1.6;
  }

  .log-line { padding: 1px 0; color: var(--muted); word-break: break-all; }
  .log-line:hover { color: var(--text); background: rgba(0,0,0,0.04); }
  .log-line.err { color: var(--danger); }
  .log-line.warn { color: var(--warn); }
  .log-line.highlight { background: rgba(0,149,107,0.08); color: var(--text); }

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

  .history-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 0;
    border-bottom: 1px solid var(--border);
    gap: 8px;
  }
  .history-row:last-child { border-bottom: none; }
  .history-row:hover { background: rgba(0,0,0,0.03); }

  .history-preview {
    background: var(--editor-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 12px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--editor-text);
    line-height: 1.6;
    max-height: 200px;
    overflow-y: auto;
    margin-top: 12px;
    white-space: pre;
  }

  /* Metrics bar chart */
  .metrics-bar-wrap { display: flex; flex-direction: column; gap: 8px; }
  .metrics-bar-row { display: flex; align-items: center; gap: 10px; }
  .metrics-bar-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); width: 32px; flex-shrink: 0; }
  .metrics-bar-track { flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
  .metrics-bar-fill { height: 100%; border-radius: 4px; transition: width 0.4s ease; }
  .metrics-bar-count { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text); width: 40px; text-align: right; flex-shrink: 0; }

  /* Login screen */
  .login-shell {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: var(--bg);
  }

  .login-card {
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: 8px;
    padding: 40px;
    width: 360px;
    max-width: calc(100vw - 32px);
  }

  .login-logo {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 24px;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 4px;
  }

  .login-sub {
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 32px;
  }

  .login-error {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--danger);
    margin-bottom: 12px;
    padding: 8px 12px;
    background: rgba(204,34,51,0.08);
    border: 1px solid rgba(204,34,51,0.2);
    border-radius: 4px;
  }

  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

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
    .grid-4 { grid-template-columns: 1fr 1fr; }
    .grid-3 { grid-template-columns: 1fr; }
    .cm-editor { min-height: 300px; }
    .editor-toolbar { flex-direction: column; align-items: flex-start; }
    .log-wrap { height: 340px; }
    .search-input { width: 100%; }
  }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getToken() { return localStorage.getItem('caddy_ui_token'); }
function setToken(token) {
    if (token) localStorage.setItem('caddy_ui_token', token);
    else localStorage.removeItem('caddy_ui_token');
}

function getTheme() { return localStorage.getItem('caddy_ui_theme') || 'dark'; }
function saveTheme(theme) { localStorage.setItem('caddy_ui_theme', theme); }

function useToast() {
    const [toasts, setToasts] = useState([]);
    const add = useCallback((msg, type = "info") => {
        const id = Date.now();
        setToasts(t => [...t, { id, msg, type }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
    }, []);
    return { toasts, success: m => add(m, "success"), error: m => add(m, "error"), info: m => add(m, "info") };
}

async function apiFetch(path, opts = {}, onUnauth) {
    const token = getToken();
    const headers = { ...(opts.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API}${path}`, { ...opts, headers });
    if (res.status === 401) {
        setToken(null);
        if (onUnauth) onUnauth();
        throw new Error('Session expired — please log in again');
    }
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

function formatTs(timestamp) {
    const ts = timestamp.endsWith('Z') ? timestamp : timestamp + 'Z';
    return new Date(ts).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
    });
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

// ── Login ─────────────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const login = async () => {
        if (!username || !password) return;
        setLoading(true);
        setError("");
        try {
            const res = await fetch(`${API}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
            const data = await res.json();
            if (!res.ok) { setError(data.error || "Login failed"); return; }
            setToken(data.token);
            onLogin();
        } catch {
            setError("Could not reach the server");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-shell">
            <style>{css}</style>
            <div className="login-card">
                <div className="login-logo">caddy/ui</div>
                <div className="login-sub">Server Manager</div>
                {error && <div className="login-error">{error}</div>}
                <div className="field">
                    <label>Username</label>
                    <input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} autoFocus autoComplete="username" />
                </div>
                <div className="field">
                    <label>Password</label>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} autoComplete="current-password" />
                </div>
                <button className="btn btn-primary" style={{ width: "100%", marginTop: 8, justifyContent: "center" }} onClick={login} disabled={loading || !username || !password}>
                    {loading ? "Signing in..." : "Sign in"}
                </button>
            </div>
        </div>
    );
}

// ── CodeMirror Editor ─────────────────────────────────────────────────────────

function CaddyfileCodeMirror({ value, onChange, theme }) {
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
            const { StreamLanguage, syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching } = await import("@codemirror/language");
            const { nginx } = await import("@codemirror/legacy-modes/mode/nginx");

            const isDark = theme === 'dark';

            const editorTheme = EditorView.theme({
                "&": { background: isDark ? "#0a0c0f" : "#f0ebe4", color: isDark ? "#c9d1e0" : "#2c2825", fontSize: "13px", fontFamily: "'IBM Plex Mono', monospace" },
                ".cm-content": { padding: "16px", caretColor: "var(--accent)", lineHeight: "1.7" },
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
                ".tok-def": { color: isDark ? "#00e5a0" : "#00956b" },
                ".tok-property": { color: isDark ? "#0099ff" : "#0077cc" },
                "& .cm-scroller": { overflow: "auto" },
            }, { dark: isDark });

            const startState = EditorState.create({
                doc: value,
                extensions: [
                    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
                    history(), drawSelection(), indentOnInput(), bracketMatching(),
                    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
                    StreamLanguage.define(nginx), editorTheme,
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
    }, [theme]); // Reinitialize when theme changes

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }, [value]);

    return <div ref={containerRef} style={{ minHeight: 420, background: theme === 'dark' ? "#0a0c0f" : "#f0ebe4" }} />;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard({ status, toast, onUnauth, setTab }) {
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
                    <div className="card">
                        <div className="card-title">Servers</div>
                        <div className="stat-val">{status.online ? status.serverCount : "—"}</div>
                        <div className="stat-label">Active server blocks</div>
                    </div>
                    <div className="card">
                        <div className="card-title">TLS</div>
                        <div className="stat-val" style={{ fontSize: 20, paddingTop: 6 }}>
                            {status.online ? <span className={`badge ${status.tlsEnabled ? "badge-green" : "badge-red"}`}>{status.tlsEnabled ? "ENABLED" : "DISABLED"}</span> : "—"}
                        </div>
                        <div className="stat-label">Certificate management</div>
                    </div>
                    <div className="card">
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
                            <div>
                                <span style={labelStyle}>Version</span>
                                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "var(--text)" }}>{process.version}</div>
                            </div>
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
                            <div className="server-row" key={s.name} onClick={() => openEdit(s)} style={{ cursor: "pointer" }}>
                                <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                        <div className="server-name">{s.name}</div>
                                        {names[s.name] && <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: "var(--text)" }}>— {names[s.name]}</span>}
                                    </div>
                                    <div className="server-meta">{s.listen?.join(", ") || "no listeners"}</div>
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                    <span className="badge badge-blue">{s.routeCount} routes</span>
                                    <span className="badge badge-green">active</span>
                                    <span style={{ color: "var(--muted)", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>✎</span>
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
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--muted)", marginBottom: 16 }}>Leave blank to clear the name.</div>
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

function CaddyfileEditor({ toast, onUnauth, theme }) {
    const [content, setContent] = useState("");
    const [original, setOriginal] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [validating, setValidating] = useState(false);
    const [runFmt, setRunFmt] = useState(true);
    const [runSort, setRunSort] = useState(true);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [previewEntry, setPreviewEntry] = useState(null);
    const [previewContent, setPreviewContent] = useState("");
    const fileInputRef = useRef(null);

    useEffect(() => {
        apiFetch("/caddyfile", {}, onUnauth)
            .then(t => { setContent(t); setOriginal(t); })
            .catch(e => toast.error(e.message))
            .finally(() => setLoading(false));
    }, []);

    const loadHistory = () => {
        setHistoryLoading(true);
        apiFetch("/caddyfile/history", {}, onUnauth).then(setHistory).catch(() => setHistory([])).finally(() => setHistoryLoading(false));
    };

    const toggleHistory = () => {
        if (!historyOpen) loadHistory();
        setHistoryOpen(o => !o);
        setPreviewEntry(null);
        setPreviewContent("");
    };

    const previewSnapshot = async (entry) => {
        if (previewEntry?.filename === entry.filename) { setPreviewEntry(null); setPreviewContent(""); return; }
        try {
            const text = await apiFetch(`/caddyfile/history/${entry.filename}`, {}, onUnauth);
            setPreviewEntry(entry); setPreviewContent(text);
        } catch (e) { toast.error(e.message); }
    };

    const restoreSnapshot = async (entry) => {
        if (!confirm(`Restore Caddyfile from ${formatTs(entry.timestamp)}? The current file will be snapshotted first.`)) return;
        try {
            const text = await apiFetch(`/caddyfile/history/${entry.filename}`, {}, onUnauth);
            await apiFetch("/caddyfile/restore", { method: "POST", headers: { "Content-Type": "text/plain" }, body: text }, onUnauth);
            const fresh = await apiFetch("/caddyfile", {}, onUnauth);
            setContent(fresh); setOriginal(fresh); setHistoryOpen(false); setPreviewEntry(null);
            toast.success(`Restored from ${formatTs(entry.timestamp)}`);
            loadHistory();
        } catch (e) { toast.error(e.message); }
    };

    const deleteSnapshot = async (entry) => {
        if (!confirm(`Delete snapshot from ${formatTs(entry.timestamp)}?`)) return;
        try {
            await apiFetch(`/caddyfile/history/${entry.filename}`, { method: "DELETE" }, onUnauth);
            toast.success("Snapshot deleted");
            if (previewEntry?.filename === entry.filename) { setPreviewEntry(null); setPreviewContent(""); }
            loadHistory();
        } catch (e) { toast.error(e.message); }
    };

    const validate = async () => {
        setValidating(true);
        try {
            const result = await apiFetch("/caddyfile/validate", { method: "POST", headers: { "Content-Type": "text/plain" }, body: content }, onUnauth);
            if (result.warnings?.length) result.warnings.forEach(w => toast.info(w));
            else toast.success("Caddyfile is valid");
        } catch (e) { toast.error(e.message); }
        finally { setValidating(false); }
    };

    const save = async () => {
        setSaving(true);
        try {
            await apiFetch(`/caddyfile?fmt=${runFmt}&sort=${runSort}`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: content }, onUnauth);
            const fresh = await apiFetch("/caddyfile", {}, onUnauth);
            setContent(fresh); setOriginal(fresh);
            toast.success("Caddyfile saved and reloaded");
            if (historyOpen) loadHistory();
        } catch (e) { toast.error(e.message); }
        finally { setSaving(false); }
    };

    const reload = async () => {
        try { await apiFetch("/caddyfile/reload", { method: "POST" }, onUnauth); toast.success("Caddy reloaded from disk"); }
        catch (e) { toast.error(e.message); }
    };

    const download = () => {
        const token = getToken();
        window.open(token ? `${API}/caddyfile/download?token=${token}` : `${API}/caddyfile/download`, '_blank');
    };

    const restore = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const text = ev.target.result;
            if (!confirm("Restore this Caddyfile? This will validate, reload Caddy, and overwrite the current file.")) return;
            try {
                await apiFetch("/caddyfile/restore", { method: "POST", headers: { "Content-Type": "text/plain" }, body: text }, onUnauth);
                const fresh = await apiFetch("/caddyfile", {}, onUnauth);
                setContent(fresh); setOriginal(fresh);
                toast.success("Caddyfile restored and reloaded");
                if (historyOpen) loadHistory();
            } catch (err) { toast.error(err.message); }
        };
        reader.readAsText(file);
        e.target.value = "";
    };

    const isDirty = content !== original;

    if (loading) return <div style={{ color: "var(--muted)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Loading Caddyfile...</div>;

    return (
        <div className="gap-16">
            <div className="editor-wrap">
                <CaddyfileCodeMirror value={content} onChange={setContent} theme={theme} />
                <div className="editor-toolbar">
                    <div className="btn-row">
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)", cursor: "pointer" }}>
                            <input type="checkbox" checked={runFmt} onChange={e => setRunFmt(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
                            caddy fmt
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)", cursor: "pointer" }}>
                            <input type="checkbox" checked={runSort} onChange={e => setRunSort(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
                            sort entries
                        </label>
                    </div>
                    <div className="btn-row">
                        <span className="editor-hint">{isDirty ? "● unsaved changes" : "✓ up to date"}</span>
                        <button className="btn btn-ghost" onClick={validate} disabled={validating}>{validating ? "Validating..." : "✓ Validate"}</button>
                        <button className="btn btn-ghost" onClick={toggleHistory}>⊙ History{history.length > 0 && !historyLoading ? ` (${history.length})` : ""}</button>
                        <button className="btn btn-ghost" onClick={download}>↓ Backup</button>
                        <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>↑ Restore</button>
                        <input ref={fileInputRef} type="file" accept="text/plain,.txt" style={{ display: "none" }} onChange={restore} />
                        <button className="btn btn-ghost" onClick={reload}>↺ Reload</button>
                        <button className="btn btn-primary" onClick={save} disabled={saving || !isDirty}>{saving ? "Saving..." : "↑ Save"}</button>
                    </div>
                </div>
            </div>

            {historyOpen && (
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--muted)" }}>Version History</span>
                        <button className="btn btn-ghost" onClick={loadHistory} disabled={historyLoading} style={{ fontSize: 11 }}>↺ Refresh</button>
                    </div>
                    {historyLoading ? (
                        <div style={{ padding: 16, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--muted)" }}>Loading...</div>
                    ) : history.length === 0 ? (
                        <div style={{ padding: 24, textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--muted)" }}>No snapshots yet — save your Caddyfile to create one</div>
                    ) : (
                        <div style={{ padding: "0 16px" }}>
                            {history.map((entry, i) => (
                                <div key={entry.filename}>
                                    <div className="history-row">
                                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: previewEntry?.filename === entry.filename ? "var(--accent)" : "var(--text)", cursor: "pointer", flex: 1 }} onClick={() => previewSnapshot(entry)}>
                                            {formatTs(entry.timestamp)}
                                            {i === 0 && <span style={{ marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--muted)" }}>latest</span>}
                                        </div>
                                        <div className="btn-row">
                                            <button className="btn btn-ghost" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => restoreSnapshot(entry)}>↺ Restore</button>
                                            <button className="btn btn-danger" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => deleteSnapshot(entry)}>✕</button>
                                        </div>
                                    </div>
                                    {previewEntry?.filename === entry.filename && <div className="history-preview">{previewContent}</div>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Routes ────────────────────────────────────────────────────────────────────

function RouteModal({ mode, initial, onSave, onClose }) {
    const isEdit = mode === "edit";
    const [form, setForm] = useState({
        domain: initial?.domain || "", upstream: initial?.upstream || "",
        stripPrefix: initial?.stripPrefix || "", _id: initial?._id || null,
        _originalDomain: initial?._originalDomain || null,
    });
    const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">{isEdit ? "Edit Route" : "New Reverse Proxy Route"}</div>
                <div className="field">
                    <label>Domain</label>
                    <input value={form.domain} onChange={set("domain")} placeholder="app.example.com" disabled={isEdit && !form._id} />
                    {isEdit && !form._id && <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--muted)", marginTop: 4 }}>Domain cannot be changed for Caddyfile-managed routes</div>}
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
                    <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.upstream || (!isEdit && !form.domain)}>
                        {isEdit ? "Save Changes" : "Add Route"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function NoteModal({ domain, initialNote, onSave, onClose }) {
    const [note, setNote] = useState(initialNote || "");
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">Route Note</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>{domain}</div>
                <div className="field">
                    <label>Note</label>
                    <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Home Assistant, media server..." autoFocus onKeyDown={e => e.key === 'Enter' && onSave(domain, note)} />
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--muted)", marginBottom: 16 }}>Leave blank to clear the note.</div>
                <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => onSave(domain, note)}>Save</button>
                </div>
            </div>
        </div>
    );
}

function RoutesManager({ toast, setTab, onUnauth }) {
    const [routes, setRoutes] = useState([]);
    const [health, setHealth] = useState({});
    const [uptime, setUptime] = useState({});
    const [certs, setCerts] = useState([]);
    const [notes, setNotes] = useState({});
    const [loading, setLoading] = useState(true);
    const [healthLoading, setHealthLoading] = useState(false);
    const [modal, setModal] = useState(null);
    const [noteModal, setNoteModal] = useState(null);
    const [sortCol, setSortCol] = useState("domain");
    const [sortDir, setSortDir] = useState("asc");
    const [search, setSearch] = useState("");

    const load = () => {
        apiFetch("/routes", {}, onUnauth).then(setRoutes).catch(e => toast.error(e.message)).finally(() => setLoading(false));
        apiFetch("/tls", {}, onUnauth).then(setCerts).catch(() => { });
        apiFetch("/route-notes", {}, onUnauth).then(setNotes).catch(() => { });
    };

    const loadHealth = () => {
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
    };

    useEffect(() => {
        load(); loadHealth();
        const t = setInterval(loadHealth, 30000);
        return () => clearInterval(t);
    }, []);

    const addRoute = async (form) => {
        try {
            await apiFetch("/routes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }, onUnauth);
            toast.success(`Route for ${form.domain} added`);
            setModal(null); load(); loadHealth();
        } catch (e) { toast.error(e.message); }
    };

    const editRoute = async (form) => {
        try {
            if (form._id) {
                await apiFetch(`/routes/${form._id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: form.domain, upstream: form.upstream, stripPrefix: form.stripPrefix }) }, onUnauth);
            } else {
                await apiFetch(`/routes/caddyfile/${encodeURIComponent(form._originalDomain)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ upstream: form.upstream, stripPrefix: form.stripPrefix }) }, onUnauth);
            }
            toast.success("Route updated");
            setModal(null); load(); loadHealth();
        } catch (e) { toast.error(e.message); }
    };

    const deleteRoute = async (id) => {
        if (!confirm("Delete this route?")) return;
        try {
            await apiFetch(`/routes/${id}`, { method: "DELETE" }, onUnauth);
            toast.success("Route removed"); load(); loadHealth();
        } catch (e) { toast.error(e.message); }
    };

    const saveNote = async (domain, note) => {
        try {
            await apiFetch(`/route-notes/${encodeURIComponent(domain)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) }, onUnauth);
            setNotes(n => { const u = { ...n }; if (note.trim()) u[domain] = note.trim(); else delete u[domain]; return u; });
            toast.success(note.trim() ? "Note saved" : "Note cleared");
            setNoteModal(null);
        } catch (e) { toast.error(e.message); }
    };

    const getHost = (route) => route.match?.find(m => m.host)?.host?.join(", ") || "—";

    const getUpstream = (route) => {
        const subroute = route.handle?.find(h => h.handler === "subroute");
        for (const r of subroute?.routes ?? []) {
            const rp = r.handle?.find(h => h.handler === "reverse_proxy");
            if (rp) return rp.upstreams?.map(u => u.dial).join(", ") || "—";
        }
        const flat = route.handle?.find(h => h.handler === "reverse_proxy");
        return flat?.upstreams?.map(u => u.dial).join(", ") || "—";
    };

    const getStripPrefix = (route) => (route.match?.find(m => m.path)?.path?.[0] || "").replace("/*", "");

    const openEdit = (route) => {
        const domain = getHost(route);
        setModal({ mode: "edit", _id: route["@id"] || null, _originalDomain: domain, domain, upstream: getUpstream(route), stripPrefix: getStripPrefix(route) });
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

    const getHealthDot = (route) => {
        const upstream = getUpstream(route);
        if (upstream === "—") return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--border2)", marginRight: 8, flexShrink: 0 }} title="No upstream" />;
        const upstreams = upstream.split(", ");
        const allOnline = upstreams.every(u => health[u] === true);
        const anyOnline = upstreams.some(u => health[u] === true);
        const checked = upstreams.some(u => u in health);
        if (!checked) return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--muted)", marginRight: 8, flexShrink: 0 }} title="Checking..." />;
        const color = allOnline ? "var(--accent)" : anyOnline ? "var(--warn)" : "var(--danger)";
        const shadow = allOnline ? "0 0 4px var(--accent)" : anyOnline ? "0 0 4px var(--warn)" : "0 0 4px var(--danger)";
        const stats = uptime[upstreams[0]];
        const uptimeLabel = stats && stats.total > 1 ? `${stats.pct}%` : null;
        return (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginRight: 8, flexShrink: 0, width: 20 }}>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: shadow }} title={allOnline ? "Online" : anyOnline ? "Partial" : "Offline"} />
                {uptimeLabel && <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "var(--muted)", marginTop: 2, lineHeight: 1, whiteSpace: "nowrap" }}>{uptimeLabel}</span>}
            </div>
        );
    };

    const handleSort = (col) => {
        if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
        else { setSortCol(col); setSortDir("asc"); }
    };

    const filtered = routes.filter(r => {
        if (!search) return true;
        const q = search.toLowerCase();
        return getHost(r).toLowerCase().includes(q) || getUpstream(r).toLowerCase().includes(q) || (notes[getHost(r)] || "").toLowerCase().includes(q);
    });

    const sorted = [...filtered].sort((a, b) => {
        let valA, valB;
        if (sortCol === "domain") { valA = getHost(a); valB = getHost(b); }
        else if (sortCol === "upstream") { valA = getUpstream(a); valB = getUpstream(b); }
        else { valA = a._server || ""; valB = b._server || ""; }
        return sortDir === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });

    const SortIcon = ({ col }) => {
        if (sortCol !== col) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
        return <span style={{ marginLeft: 4, color: "var(--accent)" }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
    };

    if (loading) return <div style={{ color: "var(--muted)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Loading routes...</div>;

    return (
        <>
            <div className="gap-16">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <input className="search-input" placeholder="Filter by domain, upstream, or note..." value={search} onChange={e => setSearch(e.target.value)} />
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)" }}>
                            {healthLoading ? "Checking..." : `${Object.values(health).filter(Boolean).length}/${Object.keys(health).length} online`}
                        </span>
                    </div>
                    <div className="btn-row">
                        <button className="btn btn-ghost" onClick={loadHealth} disabled={healthLoading} style={{ fontSize: 11 }}>↺ Check health</button>
                        <button className="btn btn-primary" onClick={() => setModal({ mode: "new" })}>+ Add Route</button>
                    </div>
                </div>
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                    {sorted.length === 0 ? (
                        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                            {search ? `No routes matching "${search}"` : "No routes configured"}
                        </div>
                    ) : (
                        <div className="table-wrap">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th onClick={() => handleSort("domain")} style={{ cursor: "pointer", userSelect: "none" }}>Domain <SortIcon col="domain" /></th>
                                        <th onClick={() => handleSort("upstream")} style={{ cursor: "pointer", userSelect: "none" }}>Upstream <SortIcon col="upstream" /></th>
                                        <th onClick={() => handleSort("server")} style={{ cursor: "pointer", userSelect: "none" }}>Server <SortIcon col="server" /></th>
                                        <th>ID</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.map((r, i) => {
                                        const domain = getHost(r);
                                        const upstream = getUpstream(r);
                                        const dLink = domainLink(domain);
                                        const uLink = upstreamLink(upstream);
                                        const hasId = !!r["@id"];
                                        const canEdit = hasId || r._simpleProxy;
                                        const note = notes[domain];
                                        return (
                                            <tr key={r["@id"] || i}>
                                                <td>
                                                    <div style={{ display: "flex", alignItems: "center" }}>
                                                        {getHealthDot(r)}
                                                        <div>
                                                            {dLink ? <a href={dLink} target="_blank" rel="noopener noreferrer" className="mono route-link">{domain}</a> : <span className="mono">{domain}</span>}
                                                            {note && <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{note}</div>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    {uLink ? <a href={uLink} target="_blank" rel="noopener noreferrer" className="mono route-link upstream">{upstream}</a> : <span className="mono" style={{ color: "var(--accent2)" }}>{upstream}</span>}
                                                </td>
                                                <td className="mono" style={{ color: "var(--muted)", fontSize: 10 }}>{r._server || "—"}</td>
                                                <td className="mono" style={{ color: "var(--muted)", fontSize: 10 }}>{r["@id"] || "—"}</td>
                                                <td style={{ width: 140, textAlign: "right" }}>
                                                    <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                                                        <button className="btn btn-ghost" style={{ padding: "4px 10px", color: note ? "var(--accent2)" : "var(--muted)" }} onClick={() => setNoteModal({ domain, note: note || "" })} title={note || "Add note"}>✎</button>
                                                        {canEdit ? (
                                                            <button className="btn btn-ghost" style={{ padding: "4px 10px" }} onClick={() => openEdit(r)} title="Edit route">⚙</button>
                                                        ) : (
                                                            <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 10 }} onClick={() => setTab("caddyfile")} title="Complex route — edit in Caddyfile">⌗</button>
                                                        )}
                                                        {hasId && <button className="btn btn-danger" style={{ padding: "4px 10px" }} onClick={() => deleteRoute(r["@id"])}>✕</button>}
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
            {modal && <RouteModal mode={modal.mode} initial={modal} onSave={modal.mode === "edit" ? editRoute : addRoute} onClose={() => setModal(null)} />}
            {noteModal && <NoteModal domain={noteModal.domain} initialNote={noteModal.note} onSave={saveNote} onClose={() => setNoteModal(null)} />}
        </>
    );
}

// ── TLS ───────────────────────────────────────────────────────────────────────

function TLSViewer({ toast, onUnauth }) {
    const [certs, setCerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");

    const load = () => {
        setLoading(true);
        apiFetch("/tls", {}, onUnauth).then(setCerts).catch(e => toast.error(e.message)).finally(() => setLoading(false));
    };

    useEffect(load, []);

    const deleteCert = async (cert) => {
        if (!confirm(`Delete orphaned cert for ${cert.domain}?`)) return;
        try {
            await apiFetch(`/tls/${cert.issuerDir}/${cert.domain}`, { method: "DELETE" }, onUnauth);
            toast.success(`Deleted cert for ${cert.domain}`); load();
        } catch (e) { toast.error(e.message); }
    };

    const downloadCA = () => {
        const token = getToken();
        window.open(token ? `${API}/tls/ca?token=${token}` : `${API}/tls/ca`, '_blank');
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
        const pct = Math.max(0, Math.min(100, (cert.daysRemaining / 90) * 100));
        const color = cert.daysRemaining < 0 ? 'var(--danger)' : cert.daysRemaining < 14 ? 'var(--warn)' : 'var(--accent)';
        return <div className="expiry-bar"><div className="expiry-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>;
    };

    const formatDate = (dateStr) => {
        try { return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
        catch { return dateStr; }
    };

    if (loading) return <div style={{ color: "var(--muted)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Loading certificates...</div>;

    return (
        <div className="gap-16">
            <div className="card">
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                    <div>
                        <div className="card-title" style={{ marginBottom: 4 }}>Root CA Certificate</div>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)", maxWidth: 480 }}>
                            Install this on your devices to trust internal TLD domains (e.g. <span style={{ color: "var(--accent)" }}>.internal</span>, <span style={{ color: "var(--accent)" }}>.home</span>) served by Caddy's built-in CA. Required after a fresh Caddy install or server rebuild.
                        </div>
                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 3 }}>
                            {[
                                { os: "iOS / iPadOS", instruction: "Open the file → Settings → Profile Downloaded → Install" },
                                { os: "macOS", instruction: "Open Keychain Access → drag in cert → set to Always Trust" },
                                { os: "Android", instruction: "Settings → Security → Install from storage" },
                                { os: "Windows", instruction: "Double-click cert → Install Certificate → Trusted Root CAs" },
                            ].map(({ os, instruction }) => (
                                <div key={os} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--muted)" }}>
                                    <span style={{ color: "var(--text)" }}>{os}</span> — {instruction}
                                </div>
                            ))}
                        </div>
                    </div>
                    <button className="btn btn-primary" onClick={downloadCA} style={{ flexShrink: 0 }}>↓ Download Root CA</button>
                </div>
            </div>

            <div className="grid-4">
                {[
                    { key: "all", label: "Total", val: summary.total, sub: "Managed certs", color: null },
                    { key: "valid", label: "Valid", val: summary.valid, sub: "Healthy", color: "var(--accent)" },
                    { key: "expiring", label: "Expiring", val: summary.expiring, sub: "Within 14 days", color: summary.expiring > 0 ? "var(--warn)" : null },
                    { key: "expired", label: "Expired", val: summary.expired, sub: "Needs renewal", color: summary.expired > 0 ? "var(--danger)" : null },
                ].map(({ key, label, val, sub, color }) => (
                    <div key={key} className="card" style={{ cursor: "pointer", borderColor: filter === key ? "var(--accent)" : "var(--border)" }} onClick={() => setFilter(key)}>
                        <div className="card-title">{label}</div>
                        <div className="stat-val" style={{ color: color || "var(--text)" }}>{val}</div>
                        <div className="stat-label">{sub}</div>
                    </div>
                ))}
            </div>

            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--muted)" }}>
                        Certificates {filter !== "all" && `— ${filter}`}
                    </span>
                    <div className="btn-row">
                        {summary.orphaned > 0 && (
                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: filter === "orphaned" ? "var(--accent)" : "var(--muted)", cursor: "pointer" }} onClick={() => setFilter(filter === "orphaned" ? "all" : "orphaned")}>
                                {summary.orphaned} orphaned
                            </span>
                        )}
                        <button className="btn btn-ghost" onClick={load} style={{ fontSize: 11 }}>↺ Refresh</button>
                    </div>
                </div>
                {filtered.length === 0 ? (
                    <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>No certificates in this category</div>
                ) : (
                    <div className="table-wrap">
                        <table className="table">
                            <thead>
                                <tr><th>Domain</th><th>Issuer</th><th>Expires</th><th>Days</th><th>Status</th><th></th></tr>
                            </thead>
                            <tbody>
                                {filtered.map((cert, i) => (
                                    <tr key={i} style={{ opacity: cert.status === 'orphaned' ? 0.6 : 1 }}>
                                        <td className="mono">{cert.domain}</td>
                                        <td><span className={`badge ${cert.issuer === 'acme' ? 'badge-blue' : 'badge-muted'}`}>{cert.issuer === 'acme' ? "Let's Encrypt" : "Internal"}</span></td>
                                        <td>
                                            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>{formatDate(cert.validTo)}</div>
                                            {expiryBar(cert)}
                                        </td>
                                        <td className="mono" style={{ color: cert.daysRemaining < 0 ? "var(--danger)" : cert.daysRemaining < 14 ? "var(--warn)" : "var(--muted)" }}>
                                            {cert.isInternal ? "auto" : `${cert.daysRemaining}d`}
                                        </td>
                                        <td>{statusBadge(cert)}</td>
                                        <td style={{ width: 60, textAlign: "right" }}>
                                            {cert.status === 'orphaned' && <button className="btn btn-danger" style={{ padding: "4px 10px" }} onClick={() => deleteCert(cert)}>✕</button>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {summary.orphaned > 0 && filter !== "orphaned" && (
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
                    {summary.orphaned} orphaned cert{summary.orphaned > 1 ? "s" : ""} hidden — stale certs for domains no longer in your Caddyfile.
                    <span style={{ color: "var(--accent2)", cursor: "pointer", marginLeft: 6 }} onClick={() => setFilter("orphaned")}>Show</span>
                </div>
            )}
        </div>
    );
}

// ── Logs ──────────────────────────────────────────────────────────────────────

function LogsViewer({ toast, onUnauth }) {
    const [lines, setLines] = useState([]);
    const [live, setLive] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [logConfig, setLogConfig] = useState(null);
    const [configDirty, setConfigDirty] = useState(false);
    const [savingConfig, setSavingConfig] = useState(false);
    const [logSearch, setLogSearch] = useState("");
    const [levelFilter, setLevelFilter] = useState("all");
    const bottomRef = useRef(null);
    const esRef = useRef(null);

    useEffect(() => {
        apiFetch("/logs", {}, onUnauth).then(data => setLines(data.lines || [])).catch(e => toast.error(e.message));
        apiFetch("/logs/config", {}, onUnauth).then(setLogConfig).catch(e => toast.error(e.message));
    }, []);

    useEffect(() => {
        if (!logSearch && levelFilter === "all") {
            if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [lines]);

    const toggleLive = () => {
        if (live) { esRef.current?.close(); esRef.current = null; setLive(false); return; }
        const token = getToken();
        const url = token ? `${API}/logs/stream?token=${token}` : `${API}/logs/stream`;
        const es = new EventSource(url);
        es.onmessage = e => {
            const data = JSON.parse(e.data);
            if (data.line) setLines(l => [...l.slice(-500), data.line]);
        };
        esRef.current = es;
        setLive(true);
    };

    useEffect(() => () => esRef.current?.close(), []);

    const classify = (line) => {
        const l = line.toLowerCase();
        if (l.includes('"level":"error"') || l.includes('error')) return 'err';
        if (l.includes('"level":"warn"') || l.includes('warn')) return 'warn';
        return '';
    };

    const matchesLevel = (line) => {
        if (levelFilter === "all") return true;
        if (levelFilter === "error") return line.toLowerCase().includes('"level":"error"');
        if (levelFilter === "warn") return line.toLowerCase().includes('"level":"warn"');
        if (levelFilter === "info") return line.toLowerCase().includes('"level":"info"');
        return true;
    };

    const filteredLines = lines.filter(line => (!logSearch || line.toLowerCase().includes(logSearch.toLowerCase())) && matchesLevel(line));

    const updateConfig = (key, value) => { setLogConfig(c => ({ ...c, [key]: value })); setConfigDirty(true); };

    const saveConfig = async () => {
        setSavingConfig(true);
        try {
            await apiFetch("/logs/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(logConfig) }, onUnauth);
            toast.success("Log config saved and reloaded");
            setConfigDirty(false);
        } catch (e) { toast.error(e.message); }
        finally { setSavingConfig(false); }
    };

    const selectStyle = { background: "var(--editor-bg)", border: "1px solid var(--border2)", borderRadius: 4, padding: "6px 10px", color: "var(--text)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, outline: "none", cursor: "pointer", width: "100%" };
    const inputStyle = { background: "var(--editor-bg)", border: "1px solid var(--border2)", borderRadius: 4, padding: "6px 10px", color: "var(--text)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, outline: "none", width: "100%" };
    const labelStyle = { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "1.2px", textTransform: "uppercase", color: "var(--muted)", marginBottom: 5, display: "block" };

    const levelBtn = (level, label, color) => (
        <button className="btn btn-ghost" style={{ fontSize: 10, padding: "4px 10px", borderColor: levelFilter === level ? color : "var(--border2)", color: levelFilter === level ? color : "var(--muted)" }} onClick={() => setLevelFilter(levelFilter === level ? "all" : level)}>
            {label}
        </button>
    );

    return (
        <div className="gap-16">
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div onClick={() => setConfigOpen(o => !o)} style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none", borderBottom: configOpen ? "1px solid var(--border)" : "none" }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--muted)" }}>Log Configuration</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {logConfig && <span className={`badge ${logConfig.enabled ? "badge-green" : "badge-red"}`}>{logConfig.enabled ? "ENABLED" : "DISABLED"}</span>}
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>{configOpen ? "▲" : "▼"}</span>
                    </div>
                </div>
                {configOpen && logConfig && (
                    <div style={{ padding: 16 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16, marginBottom: 16 }}>
                            <div>
                                <span style={labelStyle}>Logging</span>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--text)" }}>
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
                            <button className="btn btn-primary" onClick={saveConfig} disabled={savingConfig || !configDirty}>{savingConfig ? "Saving..." : "↑ Save Config"}</button>
                        </div>
                    </div>
                )}
            </div>

            <div className="log-toolbar">
                <div className="btn-row">
                    <input className="search-input" placeholder="Search logs..." value={logSearch} onChange={e => setLogSearch(e.target.value)} />
                    {levelBtn("error", "ERROR", "var(--danger)")}
                    {levelBtn("warn", "WARN", "var(--warn)")}
                    {levelBtn("info", "INFO", "var(--accent2)")}
                </div>
                <div className="btn-row">
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)" }}>
                        {filteredLines.length}{logSearch || levelFilter !== "all" ? ` / ${lines.length}` : ""} lines
                    </span>
                    {live && <div className="live-dot" />}
                    <button className={`btn ${live ? "btn-danger" : "btn-ghost"}`} onClick={toggleLive}>{live ? "■ Stop" : "▶ Live"}</button>
                    <button className="btn btn-ghost" onClick={() => apiFetch("/logs", {}, onUnauth).then(d => setLines(d.lines || []))}>↺ Refresh</button>
                </div>
            </div>
            <div className="log-wrap">
                {filteredLines.length === 0 ? (
                    <div style={{ color: "var(--muted)", padding: "8px 0" }}>{logSearch || levelFilter !== "all" ? "No lines match the current filter" : "No log lines loaded"}</div>
                ) : (
                    filteredLines.map((line, i) => (
                        <div key={i} className={`log-line ${classify(line)} ${logSearch && line.toLowerCase().includes(logSearch.toLowerCase()) ? "highlight" : ""}`}>{line}</div>
                    ))
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}

// ── Metrics ───────────────────────────────────────────────────────────────────

function MetricsViewer({ toast, onUnauth }) {
    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [configOpen, setConfigOpen] = useState(false);
    const [metricsConfig, setMetricsConfig] = useState(null);
    const [savingMetrics, setSavingMetrics] = useState(false);
    const [publicMetrics, setPublicMetrics] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        apiFetch("/status/metrics-parsed", {}, onUnauth)
            .then(setMetrics)
            .catch(() => setMetrics({ ok: false, error: "Failed to fetch metrics" }))
            .finally(() => setLoading(false));
    }, [onUnauth]);

    useEffect(() => {
        load();
        apiFetch("/status/metrics-config", {}, onUnauth).then(setMetricsConfig).catch(() => { });
        fetch(`${API}/auth/status`).then(r => r.json()).then(d => setPublicMetrics(d.publicMetrics || false)).catch(() => { });
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, [load]);

    const toggleMetrics = async (enabled) => {
        setSavingMetrics(true);
        try {
            await apiFetch("/status/metrics-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }, onUnauth);
            setMetricsConfig({ enabled });
            toast.success(enabled ? "Metrics enabled" : "Metrics disabled");
            if (enabled) setTimeout(load, 1000);
        } catch (e) { toast.error(e.message); }
        finally { setSavingMetrics(false); }
    };

    const labelStyle = { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--muted)", letterSpacing: "1.2px", textTransform: "uppercase", marginBottom: 4, display: "block" };

    const statusColors = { '2xx': 'var(--accent)', '3xx': 'var(--accent2)', '4xx': 'var(--warn)', '5xx': 'var(--danger)' };

    const formatScrapedAt = (iso) => {
        if (!iso) return "";
        const ts = iso.endsWith('Z') ? iso : iso + 'Z';
        return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    };

    return (
        <div className="gap-16">
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div onClick={() => setConfigOpen(o => !o)} style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none", borderBottom: configOpen ? "1px solid var(--border)" : "none" }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--muted)" }}>Metrics Configuration</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {metricsConfig && <span className={`badge ${metricsConfig.enabled ? "badge-green" : "badge-muted"}`}>{metricsConfig.enabled ? "ENABLED" : "DISABLED"}</span>}
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>{configOpen ? "▲" : "▼"}</span>
                    </div>
                </div>
                {configOpen && (
                    <div style={{ padding: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
                            <div>
                                <span style={labelStyle}>Caddy Metrics</span>
                                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)" }}>Enables the Prometheus metrics endpoint on Caddy's admin API</div>
                            </div>
                            <button className={`btn ${metricsConfig?.enabled ? "btn-danger" : "btn-primary"}`} onClick={() => toggleMetrics(!metricsConfig?.enabled)} disabled={savingMetrics}>
                                {savingMetrics ? "Saving..." : metricsConfig?.enabled ? "Disable" : "Enable"}
                            </button>
                        </div>
                        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                                <div>
                                    <span style={labelStyle}>Public Metrics Endpoint</span>
                                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)" }}>
                                        {publicMetrics ? <>Scrape URL: <span style={{ color: "var(--accent2)" }}>http://caddy-ui-backend:3001/api/metrics</span></> : "Set CADDY_UI_PUBLIC_METRICS=true to enable unauthenticated Prometheus scraping"}
                                    </div>
                                </div>
                                <span className={`badge ${publicMetrics ? "badge-green" : "badge-muted"}`}>{publicMetrics ? "ENABLED" : "DISABLED"}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {loading ? (
                <div style={{ color: "var(--muted)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Loading metrics...</div>
            ) : !metrics?.ok ? (
                <div className="card">
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <span>Metrics not enabled — enable above to see request data</span>
                        <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setConfigOpen(true)}>Configure →</button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="grid-3">
                        <div className="card">
                            <div className="card-title">Total Requests</div>
                            <div className="stat-val">{metrics.totalRequests.toLocaleString()}</div>
                            <div className="stat-label">Since process start</div>
                        </div>
                        <div className="card">
                            <div className="card-title">Requests / sec</div>
                            <div className="stat-val" style={{ color: "var(--accent)" }}>{metrics.rps ?? "—"}</div>
                            <div className="stat-label">Avg over uptime</div>
                        </div>
                        <div className="card">
                            <div className="card-title">Avg Response</div>
                            <div className="stat-val" style={{ color: metrics.avgResponseMs > 500 ? "var(--warn)" : "var(--text)" }}>
                                {metrics.avgResponseMs}<span style={{ fontSize: 14, color: "var(--muted)", marginLeft: 4 }}>ms</span>
                            </div>
                            <div className="stat-label">Mean response time</div>
                        </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                        <div className="card">
                            <div className="card-title">Status Codes</div>
                            <div className="metrics-bar-wrap">
                                {Object.entries(metrics.statusGroups).map(([group, count]) => {
                                    const pct = Math.round((count / (metrics.totalRequests || 1)) * 100);
                                    return (
                                        <div key={group} className="metrics-bar-row">
                                            <div className="metrics-bar-label" style={{ color: statusColors[group] }}>{group}</div>
                                            <div className="metrics-bar-track">
                                                <div className="metrics-bar-fill" style={{ width: `${pct}%`, background: statusColors[group] }} />
                                            </div>
                                            <div className="metrics-bar-count">{count}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="card">
                            <div className="card-title">Response Time Percentiles</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                                {[
                                    { label: "p50", val: metrics.p50, color: "var(--accent)" },
                                    { label: "p95", val: metrics.p95, color: "var(--warn)" },
                                    { label: "p99", val: metrics.p99, color: "var(--danger)" },
                                ].map(({ label, val, color }) => (
                                    <div key={label}>
                                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)" }}>{label}</span>
                                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color }}>{val}<span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 3 }}>ms</span></span>
                                        </div>
                                        <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                                            <div style={{ height: "100%", width: `${Math.min(100, (val / (metrics.p99 || 1)) * 100)}%`, background: color, borderRadius: 2, transition: "width 0.4s" }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--muted)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>Refreshes every 30s</span>
                        <div className="btn-row">
                            <span>Last scraped: {formatScrapedAt(metrics.scrapedAt)}</span>
                            <button className="btn btn-ghost" onClick={load} style={{ fontSize: 11 }}>↺ Refresh</button>
                        </div>
                    </div>
                </>
            )}
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
    { id: "metrics", label: "Metrics", icon: "∿" },
];

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
    const [tab, setTab] = useState("dashboard");
    const [status, setStatus] = useState(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [authEnabled, setAuthEnabled] = useState(false);
    const [authed, setAuthed] = useState(!!getToken());
    const [theme, setTheme] = useState(getTheme);
    const toast = useToast();

    const onUnauth = useCallback(() => { setToken(null); setAuthed(false); }, []);

    // Apply theme class to root
    useEffect(() => {
        if (theme === 'light') {
            document.documentElement.classList.add('light');
        } else {
            document.documentElement.classList.remove('light');
        }
        saveTheme(theme);
    }, [theme]);

    useEffect(() => {
        fetch(`${API}/auth/status`)
            .then(r => r.json())
            .then(d => { setAuthEnabled(d.authEnabled); if (!d.authEnabled) setAuthed(true); })
            .catch(() => setAuthed(true));
    }, []);

    const fetchStatus = useCallback(() => {
        apiFetch("/status", {}, onUnauth).then(setStatus).catch(() => setStatus({ online: false, error: "Could not reach backend" }));
    }, [onUnauth]);

    useEffect(() => {
        if (!authed) return;
        fetchStatus();
        const t = setInterval(fetchStatus, 15000);
        return () => clearInterval(t);
    }, [authed, fetchStatus]);

    const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

    if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;

    const titles = {
        dashboard: "Dashboard",
        caddyfile: "Caddyfile Editor",
        routes: "Route Manager",
        tls: "TLS Certificates",
        logs: "Access Logs",
        metrics: "Metrics",
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
                            <span style={{ color: "var(--muted)" }}>{status ? (status.online ? "connected" : "unreachable") : "checking..."}</span>
                        </div>
                    </div>
                    <nav className="nav">
                        {NAV.map(n => (
                            <div key={n.id} className={`nav-item ${tab === n.id ? "active" : ""}`} onClick={() => { setTab(n.id); setSidebarOpen(false); }}>
                                <span className="nav-icon">{n.icon}</span>
                                {n.label}
                            </div>
                        ))}
                    </nav>
                    {authEnabled && (
                        <div className="nav-footer">
                            <div className="nav-item" onClick={onUnauth}>
                                <span className="nav-icon">⏻</span>
                                Sign out
                            </div>
                        </div>
                    )}
                </aside>

                <div className="main">
                    <div className="topbar">
                        <div className="topbar-left">
                            <button className="hamburger" onClick={() => setSidebarOpen(o => !o)}>☰</button>
                            <span className="page-title">{titles[tab]}</span>
                        </div>
                        <div className="btn-row">
                            <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                                {theme === 'dark' ? '☀' : '☾'}
                            </button>
                            <button className="btn btn-ghost" onClick={fetchStatus} style={{ fontSize: 11 }}>↺ Refresh</button>
                        </div>
                    </div>
                    <div className="content">
                        {tab === "dashboard" && <Dashboard status={status} toast={toast} onUnauth={onUnauth} setTab={setTab} />}
                        {tab === "caddyfile" && <CaddyfileEditor toast={toast} onUnauth={onUnauth} theme={theme} />}
                        {tab === "routes" && <RoutesManager toast={toast} setTab={setTab} onUnauth={onUnauth} />}
                        {tab === "tls" && <TLSViewer toast={toast} onUnauth={onUnauth} />}
                        {tab === "logs" && <LogsViewer toast={toast} onUnauth={onUnauth} />}
                        {tab === "metrics" && <MetricsViewer toast={toast} onUnauth={onUnauth} />}
                    </div>
                </div>
            </div>
            <Toasts toasts={toast.toasts} />
        </>
    );
}

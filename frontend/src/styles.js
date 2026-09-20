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

export const css = `
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

  .shell { display: flex; height: 100vh; height: 100dvh; overflow: hidden; }

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

  .status-pill-text { color: var(--muted); }

  .status-refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin-left: 2px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
  }
  .status-refresh:hover { color: var(--text); background: rgba(255,255,255,0.06); }

  .instance-switcher {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .instance-switcher-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 8px;
  }

  .instance-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    color: var(--muted);
    transition: all 0.15s;
  }

  .instance-item:hover { color: var(--text); background: rgba(0,0,0,0.04); }

  .instance-item.active {
    color: var(--accent);
    background: rgba(0,149,107,0.07);
  }

  .instance-name {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

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

  .sidebar-version {
    padding: 8px 20px 0;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--muted);
    letter-spacing: 0.5px;
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

  .server-edit-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    margin: -4px;
    border-radius: 4px;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
  }
  .server-edit-icon:hover { color: var(--text); background: rgba(255,255,255,0.06); }

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
  .editor-hint--mobile { display: none; }

  .tls-ca-actions { flex-shrink: 0; }
  .btn.tls-refresh--mobile { display: none; }

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
    top: 12px; right: 19px;
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
    width: 380px;
    transition: border-color 0.15s;
  }
  .search-input--clearable { padding-right: 28px; }
  .search-input:focus { border-color: var(--accent); }
  .search-input::placeholder { color: var(--muted); }

  .search-wrap { position: relative; }
  .search-clear {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 4px;
    line-height: 1;
    border-radius: 2px;
  }
  .search-clear:hover { color: var(--text); }

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

  .modal--confirm { width: 380px; }
  .modal--confirm .modal-title { font-weight: 400; line-height: 1.5; }

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
  .log-line.info { color: var(--accent2); }
  .log-line.err:hover,
  .log-line.warn:hover,
  .log-line.info:hover {
    background: rgba(0,0,0,0.04);
    filter: brightness(1.35);
  }
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
    overflow-x: auto;
    margin-top: 12px;
    white-space: pre;
  }

  .metrics-bar-wrap { display: flex; flex-direction: column; gap: 8px; }
  .metrics-bar-row { display: flex; align-items: center; gap: 10px; }
  .metrics-bar-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); width: 32px; flex-shrink: 0; }
  .metrics-bar-track { flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
  .metrics-bar-fill { height: 100%; border-radius: 4px; transition: width 0.4s ease; }
  .metrics-bar-count { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text); width: 40px; text-align: right; flex-shrink: 0; }

  .login-shell {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    height: 100dvh;
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

  /* ── Utility: Loading states ─────────────────────────────────────────────── */

  .loading {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: var(--muted);
  }

  /* ── Utility: Typography ──────────────────────────────────────────────────── */

  .section-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--muted);
  }

  .field-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 4px;
    display: block;
  }

  .metrics-status-text {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    font-weight: 500;
    flex-shrink: 0;
  }

  .hint {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--muted);
    margin-bottom: 16px;
  }

  .data-val {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    color: var(--text);
  }

  .data-val--accent { color: var(--accent); }
  .data-val--danger { color: var(--danger); }
  .data-val--muted  { color: var(--muted); font-size: 11px; }

  /* ── Utility: Card variants ───────────────────────────────────────────────── */

  .card-clickable { cursor: pointer; }
  .card-clickable:hover { border-color: var(--border2); }

  .card-danger { border-color: rgba(204,34,51,0.3); }
  .card-danger .card-title { color: var(--danger); }

  .card-flush { padding: 0; overflow: hidden; }

  .card-header {
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
  }

  .card-header--clickable {
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    user-select: none;
  }

  .card-header--clickable.is-open { border-bottom: 1px solid var(--border); }

  .card-body { padding: 16px; }

  .card-empty {
    padding: 24px;
    text-align: center;
    color: var(--muted);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
  }

  /* ── Utility: Modal ───────────────────────────────────────────────────────── */

  .modal-hint {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--muted);
    margin-bottom: 16px;
  }

  .modal-badges {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }

  .modal-section-divider {
    border-top: 1px solid var(--border);
    margin: 4px 0 20px;
  }

  .modal-section-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 12px;
  }

  /* ── Utility: Table ───────────────────────────────────────────────────────── */

  .th-sortable { cursor: pointer; user-select: none; }

  .sort-icon { opacity: 0.3; margin-left: 4px; }
  .sort-icon--active { margin-left: 4px; color: var(--accent); }

  .col-actions { width: 100px; text-align: right; }
  .col-actions-sm { width: 60px; text-align: right; }

  .cell-muted { color: var(--muted); font-size: 10px; }

  /* ── Utility: Buttons ─────────────────────────────────────────────────────── */

  .btn--icon { padding: 4px 10px; }
  .btn--sm   { padding: 3px 10px; font-size: 11px; }
  .btn--full { width: 100%; justify-content: center; margin-top: 8px; }
  .btn--right { margin-left: auto; }

  /* ── Utility: Layout ──────────────────────────────────────────────────────── */

  .flex-between {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .flex-center {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .flex-end {
    display: flex;
    justify-content: flex-end;
  }

  .flex-col-sm {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .process-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 16px;
  }

  .inline-muted {
    color: var(--muted);
    font-size: 11px;
    margin-left: 4px;
  }

  /* ── Utility: Caddyfile-managed route notice ──────────────────────────────── */

  .modal-editor-wrap {
    border-radius: 4px;
    overflow: hidden;
  }

  .modal-editor-wrap .cm-editor { min-height: 180px; max-height: 340px; font-family: 'IBM Plex Mono', monospace !important; }
  .modal-editor-wrap .cm-editor.cm-focused { outline: none; }
  .modal-editor-wrap .cm-scroller { max-height: 340px; }

  .caddyfile-notice {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    background: rgba(0,0,0,0.15);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 12px;
    margin-bottom: 8px;
  }

  /* ── Utility: Metrics ─────────────────────────────────────────────────────── */

  .metrics-footer {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--muted);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .metrics-footer-label {
    letter-spacing: 1px;
    text-transform: uppercase;
    font-size: 10px;
  }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  .percentile-rows { display: flex; flex-direction: column; gap: 14px; }
  .percentile-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .percentile-bar-track { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .percentile-bar-fill { height: 100%; border-radius: 2px; transition: width 0.4s; }
  .percentile-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); }
  .percentile-val { font-family: 'IBM Plex Mono', monospace; font-size: 13px; }
  .percentile-unit { font-size: 10px; color: var(--muted); margin-left: 3px; }
  .ms-unit { font-size: 14px; color: var(--muted); margin-left: 4px; }

  /* ── Utility: Log config form elements ───────────────────────────────────── */

  .config-select, .config-input {
    background: var(--editor-bg);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 6px 10px;
    color: var(--text);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    outline: none;
    width: 100%;
  }

  .config-section-divider { border-top: 1px solid var(--border); padding-top: 16px; }

  .config-select {
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23586275' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 28px;
  }
  :root.light .config-select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238a7f75' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  }
  .config-select:disabled, .config-input:disabled { opacity: 0.4; cursor: not-allowed; }

  .config-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 16px;
    margin-bottom: 16px;
  }

  .config-grid-full { grid-column: 1 / -1; }

  .config-checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: var(--text);
  }

  .config-checkbox { accent-color: var(--accent); width: 14px; height: 14px; }

  .log-empty {
    color: var(--muted);
    padding: 8px 0;
  }

  /* ── Utility: Health dot ──────────────────────────────────────────────────── */

  .health-dot-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
  }

  .health-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .health-dot--none    { background: var(--border2); }
  .health-dot--pending { background: var(--muted); }

  .route-note--mobile {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--muted);
    margin-top: 2px;
    display: none;
  }
  .col-title { font-size: 12px; }

  .route-domain-cell { display: flex; align-items: center; gap: 8px; }

  .route-domain-sep { color: var(--muted); }

  /* ── Utility: Server name display ─────────────────────────────────────────── */

  .server-display-name {
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 12px;
    color: var(--text);
  }

  .server-separator {
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 12px;
    color: var(--muted);
  }

  .server-row--clickable { cursor: pointer; }

  .chevron { color: var(--muted); font-size: 12px; }
    color: var(--muted);
    font-size: 11px;
    font-family: 'IBM Plex Mono', monospace;
  }

  /* ── Utility: Uptime label ────────────────────────────────────────────────── */

  .uptime-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    color: var(--muted);
    margin-top: 2px;
    line-height: 1;
    white-space: nowrap;
  }

  /* ── Utility: Log toolbar ─────────────────────────────────────────────────── */

  .log-line-count {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--muted);
  }
  .log-line-count--mobile { display: none; }

  .btn.btn-ghost.level-btn--error.is-active, .btn.btn-ghost.level-btn--error:hover { border-color: var(--danger); color: var(--danger); }
  .btn.btn-ghost.level-btn--warn.is-active,  .btn.btn-ghost.level-btn--warn:hover  { border-color: var(--warn);   color: var(--warn); }
  .btn.btn-ghost.level-btn--info.is-active,  .btn.btn-ghost.level-btn--info:hover  { border-color: var(--accent2); color: var(--accent2); }

  /* ── Utility: Editor toolbar ──────────────────────────────────────────────── */

  .editor-checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    cursor: pointer;
  }

  .editor-checkbox { accent-color: var(--accent); }

  /* ── Utility: History entry ───────────────────────────────────────────────── */

  .history-entry {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    cursor: pointer;
    flex: 1;
  }

  .history-entry--active { color: var(--accent); }
  .history-entry--default { color: var(--text); }

  .history-body { padding: 0 16px; }

  /* ── Utility: History ─────────────────────────────────────────────────────── */

  .history-latest {
    margin-left: 8px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--muted);
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
    .content { padding: 16px; padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
    .topbar { padding: 12px 16px; }
    .grid-4 { grid-template-columns: 1fr 1fr; }
    .grid-3 { grid-template-columns: 1fr; }
    .grid-2 { grid-template-columns: 1fr; }
    .metrics-footer { flex-direction: column; align-items: flex-start; gap: 8px; }
    .cm-editor { min-height: 300px; }
    .cm-editor .cm-content { font-size: 16px; }
    .modal-editor-wrap .cm-editor { min-height: 160px; max-height: 260px; }
    .modal-editor-wrap .cm-scroller { max-height: 260px; }
    .editor-toolbar { flex-direction: column; align-items: stretch; }
    .editor-hint--desktop { display: none; }
    .editor-hint--mobile { display: inline; margin-left: auto; }
    .editor-toolbar-actions .btn { flex: 1 1 90px; }
    .log-wrap { height: 340px; }
    .search-wrap { width: 100%; }
    .search-input { width: 100%; }
    .log-toolbar { flex-direction: column; align-items: stretch; }
    .log-toolbar .btn-row { width: 100%; }
    .log-save-btn { width: 100%; justify-content: center; }
    .log-line-count--desktop { display: none; }
    .log-line-count--mobile { display: inline; margin-left: auto; }
    .col-title { display: none; }
    .route-note--mobile { display: block; }
    .routes-toolbar { flex-direction: column; align-items: stretch; }
    .routes-toolbar .flex-center { width: 100%; }
    .routes-toolbar-actions .btn-ghost { flex: 1 1 0; }
    .routes-toolbar-actions .btn-primary { flex: 2 1 0; }
    .btn.tls-refresh--desktop { display: none; }
    .btn.tls-refresh--mobile { display: inline-flex; }
    .tls-ca-actions { flex: 1 1 100%; }
    .tls-ca-actions .btn-ghost { flex: 1 1 0; }
    .tls-ca-actions .btn-primary { flex: 2 1 0; }
    .log-config-enabled { grid-column: 1 / -1; }
    .log-enabled-btn { width: 100%; justify-content: center; }
    .metrics-toggle-btn { flex: 1 1 100%; justify-content: center; }
    .metrics-status-text { display: block; width: 100%; margin-top: 8px; }
    .notifications-enabled-btn { width: 100%; justify-content: center; }
    .notif-test-btn { order: 1; flex: 1 1 0; justify-content: center; }
    .notif-save-btn { order: 2; flex: 2 1 0; justify-content: center; }

    /* iOS Safari zooms the page in on focus when a field's font-size is under
       16px; bump these to 16px on mobile so focusing them doesn't zoom. */
    .search-input,
    .field input,
    .config-select,
    .config-input {
      font-size: 16px;
    }
  }
`;

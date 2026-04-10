const NAV = [
    { id: "dashboard", label: "Dashboard", icon: "◈" },
    { id: "caddyfile", label: "Caddyfile", icon: "⌗" },
    { id: "routes", label: "Routes", icon: "⇌" },
    { id: "tls", label: "TLS", icon: "⊕" },
    { id: "logs", label: "Logs", icon: "≡" },
    { id: "metrics", label: "Metrics", icon: "∿" },
];

export default function Sidebar({ tab, setTab, status, authEnabled, onUnauth, sidebarOpen, setSidebarOpen }) {
    return (
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
                    <div
                        key={n.id}
                        className={`nav-item ${tab === n.id ? "active" : ""}`}
                        onClick={() => { setTab(n.id); setSidebarOpen(false); }}
                    >
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
    );
}

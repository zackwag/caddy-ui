import { useNavigate } from "react-router-dom";

const NAV = [
    { path: "/dashboard", label: "Dashboard", icon: "◈" },
    { path: "/caddyfile", label: "Caddyfile", icon: "⌗" },
    { path: "/routes", label: "Routes", icon: "⇌" },
    { path: "/tls", label: "TLS", icon: "⊕" },
    { path: "/logs", label: "Logs", icon: "≡" },
    { path: "/metrics", label: "Metrics", icon: "∿" },
];

export default function Sidebar({ currentPath, status, authEnabled, onUnauth, sidebarOpen, setSidebarOpen }) {
    const navigate = useNavigate();

    const go = (path) => {
        navigate(path);
        setSidebarOpen(false);
    };

    return (
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
            <div className="sidebar-logo">
                <div className="logo-mark">caddy/ui</div>
                <div className="logo-sub">Server Manager</div>
                <div className="status-pill">
                    <div className={`status-dot ${status ? (status.online ? "online" : "offline") : ""}`} />
                    <span className="status-pill-text">
                        {status ? (status.online ? "connected" : "unreachable") : "checking..."}
                    </span>
                </div>
            </div>
            <nav className="nav">
                {NAV.map(n => (
                    <div
                        key={n.path}
                        className={`nav-item ${currentPath === n.path ? "active" : ""}`}
                        onClick={() => go(n.path)}
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

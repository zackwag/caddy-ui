import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../utils/api.js";

const FRONTEND_VERSION = import.meta.env.VITE_APP_VERSION || "dev";

const NAV = [
    { path: "/dashboard", label: "Dashboard", icon: "◈" },
    { path: "/caddyfile", label: "Caddyfile", icon: "⌗" },
    { path: "/routes", label: "Routes", icon: "⇌" },
    { path: "/tls", label: "TLS", icon: "⊕" },
    { path: "/logs", label: "Logs", icon: "≡" },
    { path: "/metrics", label: "Metrics", icon: "∿" },
    { path: "/notifications", label: "Notifications", icon: "⊘" },
];

export default function Sidebar({ currentPath, status, authEnabled, onUnauth, sidebarOpen, setSidebarOpen }) {
    const navigate = useNavigate();
    const [backendVersion, setBackendVersion] = useState(null);

    useEffect(() => {
        apiFetch("/version", {}, onUnauth).then(r => setBackendVersion(r.version)).catch(() => { });
    }, []);

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
            <div className="nav-footer">
                {authEnabled && (
                    <div className="nav-item" onClick={onUnauth}>
                        <span className="nav-icon">⏻</span>
                        Sign out
                    </div>
                )}
                <div className="sidebar-version" title={backendVersion && backendVersion !== FRONTEND_VERSION ? `frontend v${FRONTEND_VERSION} · backend v${backendVersion}` : undefined}>
                    v{FRONTEND_VERSION}{backendVersion && backendVersion !== FRONTEND_VERSION ? ` (backend v${backendVersion})` : ""}
                </div>
            </div>
        </aside>
    );
}

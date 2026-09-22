import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, getInstanceId, setInstanceId } from "../utils/api.js";

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

export default function Sidebar({ currentPath, status, onRefreshStatus, authEnabled, onUnauth, sidebarOpen, setSidebarOpen, onInstanceChange }) {
    const navigate = useNavigate();
    const [backendVersion, setBackendVersion] = useState(null);
    const [instances, setInstances] = useState([]);
    const [instanceStatus, setInstanceStatus] = useState({});
    const [selectedId, setSelectedId] = useState(getInstanceId);

    useEffect(() => {
        apiFetch("/version", {}, onUnauth).then(r => setBackendVersion(r.version)).catch(() => { });
        apiFetch("/instances", {}, onUnauth).then(setInstances).catch(() => { });
    }, [onUnauth]);

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

    const switchInstance = (id) => {
        setInstanceId(id);
        setSelectedId(id);
        if (onInstanceChange) onInstanceChange(id);
    };

    const go = (path) => {
        navigate(path);
        setSidebarOpen(false);
    };

    const showSwitcher = instances.length > 1;

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
                    <button className="status-refresh" onClick={onRefreshStatus} title="Refresh status">↺</button>
                </div>
            </div>
            {showSwitcher && (
                <div className="instance-switcher">
                    <div className="instance-switcher-label">Instances</div>
                    {instances.map(inst => (
                        <div
                            key={inst.id}
                            className={`instance-item ${selectedId === inst.id ? "active" : ""}`}
                            onClick={() => switchInstance(inst.id)}
                        >
                            <div className={`status-dot ${instanceStatus[inst.id] === true ? "online" : instanceStatus[inst.id] === false ? "offline" : ""}`} />
                            <span className="instance-name">{inst.name}</span>
                        </div>
                    ))}
                </div>
            )}
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

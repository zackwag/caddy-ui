import { useEffect, useRef, useState } from "react";
import { PixelIcon, UtilityIcon } from "./Icons.jsx";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useClickOutside } from "../hooks/useClickOutside.js";
import { useInstanceStatus } from "../hooks/useInstanceStatus.js";
import { apiFetch, setInstanceId } from "../utils/api.js";
import { updateLink } from "../utils/updateLink.js";

const FRONTEND_VERSION = import.meta.env.VITE_APP_VERSION || "dev";

// Releases read "v2.17.0"; edge/beta/dev builds show their name as is
// ("edge-c6a3f0f", not "vedge-c6a3f0f")
const displayVersion = (version) => /^\d/.test(version) ? `v${version}` : version;

const NAV = [
    { path: "/dashboard", labelKey: "sidebar.nav.dashboard", icon: "dashboard" },
    { path: "/routes", labelKey: "sidebar.nav.routes", icon: "routes" },
    { path: "/caddyfile", labelKey: "sidebar.nav.caddyfile", icon: "caddyfile" },
    { path: "/tls", labelKey: "sidebar.nav.tls", icon: "tls" },
    { path: "/logs", labelKey: "sidebar.nav.logs", icon: "logs" },
    { path: "/metrics", labelKey: "sidebar.nav.metrics", icon: "metrics" },
    { path: "/notifications", labelKey: "sidebar.nav.notifications", icon: "notifications" },
    { path: "/instances", labelKey: "sidebar.nav.instances", icon: "instances" },
];

export default function Sidebar({ currentPath, status, onRefreshStatus, authEnabled, onUnauth, onLogout, onSecurity, sidebarOpen, setSidebarOpen, selectedInstanceId, onInstanceChange, instanceListVersion }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [backendVersion, setBackendVersion] = useState(null);
    const [instances, setInstances] = useState([]);
    const instanceStatus = useInstanceStatus(onUnauth);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef(null);
    const [update, setUpdate] = useState(null);

    useEffect(() => {
        apiFetch(`/version?frontend=${encodeURIComponent(FRONTEND_VERSION)}`, {}, onUnauth)
            .then(r => {
                setBackendVersion(r.version);
                setUpdate(r.update);
            })
            .catch(() => { });
    }, [onUnauth]);

    // The backend compares both images against the published versions.json;
    // each field is the newer version to offer, or null
    const updateParts = [
        update?.frontend && t("sidebar.updatePartFrontend", { version: update.frontend }),
        update?.backend && t("sidebar.updatePartBackend", { version: update.backend }),
    ].filter(Boolean);
    const updateUrl = updateLink(update, { backend: backendVersion, frontend: FRONTEND_VERSION });

    useEffect(() => {
        apiFetch("/instances", {}, onUnauth).then(setInstances).catch(() => { });
    }, [onUnauth, instanceListVersion]);

    useClickOutside(dropdownRef, () => setDropdownOpen(false), dropdownOpen);

    const switchInstance = (id) => {
        setInstanceId(id);
        setDropdownOpen(false);
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
                <div className="logo-sub">{t("sidebar.serverManager")}</div>
                <div className="status-pill">
                    <div className={`status-dot ${status ? (status.online ? "online" : "offline") : ""}`} />
                    <span className="status-pill-text">
                        {status ? (status.online ? t("sidebar.connected") : t("sidebar.unreachable")) : t("sidebar.checking")}
                    </span>
                    <button className="status-refresh" onClick={onRefreshStatus} title={t("sidebar.refreshStatus")} aria-label={t("sidebar.refreshStatus")}><UtilityIcon name="refresh" /></button>
                </div>
            </div>
            {showSwitcher && (() => {
                const selected = instances.find(i => i.id === selectedInstanceId) || instances[0];
                return (
                    <div className="instance-dropdown" ref={dropdownRef}>
                        <button className="instance-dropdown-trigger" onClick={() => setDropdownOpen(o => !o)}>
                            <div className={`status-dot ${instanceStatus[selected?.id] === true ? "online" : instanceStatus[selected?.id] === false ? "offline" : ""}`} />
                            <span className="instance-dropdown-name">{selected?.name || t("sidebar.selectInstance")}</span>
                            <span className={`instance-dropdown-chevron ${dropdownOpen ? "open" : ""}`}><UtilityIcon name="chevronDown" /></span>
                        </button>
                        {dropdownOpen && (
                            <div className="instance-dropdown-menu">
                                {instances.map(inst => (
                                    <div
                                        key={inst.id}
                                        className={`instance-dropdown-item ${selectedInstanceId === inst.id ? "active" : ""}`}
                                        onClick={() => switchInstance(inst.id)}
                                    >
                                        <div className={`status-dot ${instanceStatus[inst.id] === true ? "online" : instanceStatus[inst.id] === false ? "offline" : ""}`} />
                                        <span className="instance-name">{inst.name}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })()}
            <nav className="nav">
                {NAV.map(n => (
                    <div
                        key={n.path}
                        className={`nav-item ${currentPath === n.path ? "active" : ""}`}
                        onClick={() => go(n.path)}
                    >
                        <span className="nav-icon"><PixelIcon name={n.icon} /></span>
                        {t(n.labelKey)}
                    </div>
                ))}
            </nav>
            <div className="nav-footer">
                {onSecurity && <button type="button" className="nav-item sidebar-signout" onClick={onSecurity}>
                    <span className="nav-icon"><PixelIcon name="key" /></span>{t('security.title')}
                </button>}
                {authEnabled && (
                    <button type="button" className="nav-item sidebar-signout" onClick={onLogout || onUnauth}>
                        <span className="nav-icon"><PixelIcon name="logout" /></span>
                        {t("sidebar.signOut")}
                    </button>
                )}
                {updateParts.length > 0 && (
                    <a
                        className="badge badge-green sidebar-update-badge"
                        href={updateUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={t("sidebar.availableUpdates", { parts: updateParts.join(" · ") })}
                    >
                        {t("sidebar.updateAvailable")} <UtilityIcon name="external" />
                    </a>
                )}
                <div className="sidebar-version" title={backendVersion && backendVersion !== FRONTEND_VERSION ? t("sidebar.versionDetails", { frontend: displayVersion(FRONTEND_VERSION), backend: displayVersion(backendVersion) }) : undefined}>
                    {displayVersion(FRONTEND_VERSION)}{backendVersion && backendVersion !== FRONTEND_VERSION ? t("sidebar.backendVersion", { version: displayVersion(backendVersion) }) : ""}
                </div>
            </div>
        </aside>
    );
}

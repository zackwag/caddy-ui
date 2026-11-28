import { useEffect, useId, useRef, useState } from "react";
import { PixelIcon, UtilityIcon } from "./Icons.jsx";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useClickOutside } from "../hooks/useClickOutside.js";
import { useInstanceStatus } from "../hooks/useInstanceStatus.js";
import { apiFetch } from "../utils/api.js";
import { updateLink } from "../utils/updateLink.js";
import { documentationLink } from "../utils/documentationLink.js";
import { VIEWS } from "../views.js";
import StatusDot from "./StatusDot.jsx";

const FRONTEND_VERSION = import.meta.env.VITE_APP_VERSION || "dev";

// Releases read "v2.17.0"; edge/beta/dev builds show their name as is
// ("edge-c6a3f0f", not "vedge-c6a3f0f")
const displayVersion = (version) => /^\d/.test(version) ? `v${version}` : version;

export default function Sidebar({ currentPath, status, onRefreshStatus, onLogout, onSecurity, sidebarOpen, setSidebarOpen, selectedInstanceId, onSwitchInstance, instances }) {
    const { t } = useTranslation();
    const newTabDescriptionId = useId();
    const navigate = useNavigate();
    const [backendVersion, setBackendVersion] = useState(null);
    const instanceStatus = useInstanceStatus();
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef(null);
    const [update, setUpdate] = useState(null);

    useEffect(() => {
        apiFetch(`/version?frontend=${encodeURIComponent(FRONTEND_VERSION)}`)
            .then(r => {
                setBackendVersion(r.version);
                setUpdate(r.update);
            })
            .catch(() => { });
    }, []);

    // The backend compares both images against the published versions.json;
    // each field is the newer version to offer, or null
    const updateParts = [
        update?.frontend && t("sidebar.updatePartFrontend", { version: update.frontend }),
        update?.backend && t("sidebar.updatePartBackend", { version: update.backend }),
    ].filter(Boolean);
    const updateUrl = updateLink(update, { backend: backendVersion, frontend: FRONTEND_VERSION });
    const documentationUrl = documentationLink({ frontend: FRONTEND_VERSION, backend: backendVersion });

    useClickOutside(dropdownRef, () => setDropdownOpen(false), dropdownOpen);

    const switchInstance = (id) => {
        setDropdownOpen(false);
        onSwitchInstance(id);
    };

    const go = (path) => {
        navigate(path);
        setSidebarOpen(false);
    };

    const showSwitcher = instances?.length > 1;

    return (
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
            <div className="sidebar-logo">
                <div className="logo-mark">caddy/ui</div>
                <div className="logo-sub">{t("sidebar.serverManager")}</div>
                <div className="status-pill">
                    <StatusDot online={status?.online} />
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
                            <StatusDot online={instanceStatus[selected?.id]} />
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
                                        <StatusDot online={instanceStatus[inst.id]} />
                                        <span className="instance-name">{inst.name}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })()}
            <nav className="nav">
                {VIEWS.map(n => (
                    <div
                        key={n.path}
                        className={`nav-item ${currentPath === n.path ? "active" : ""}`}
                        onClick={() => go(n.path)}
                    >
                        <span className="nav-icon"><PixelIcon name={n.icon} /></span>
                        {t(n.navKey)}
                    </div>
                ))}
            </nav>
            <div className="nav-footer">
                <button type="button" className="nav-item sidebar-signout" onClick={onSecurity}>
                    <span className="nav-icon"><PixelIcon name="key" /></span>{t('security.title')}
                </button>
                <button type="button" className="nav-item sidebar-signout" onClick={onLogout}>
                    <span className="nav-icon"><PixelIcon name="logout" /></span>
                    {t("sidebar.signOut")}
                </button>
                {updateParts.length > 0 && (
                    <a
                        className="badge badge-green sidebar-update-badge"
                        href={updateUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={t("sidebar.availableUpdates", { parts: updateParts.join(" · ") })}
                        aria-describedby={newTabDescriptionId}
                    >
                        {t("sidebar.updateAvailable")} <UtilityIcon name="external" />
                    </a>
                )}
                <span id={newTabDescriptionId} className="sr-only">{t("sidebar.opensInNewTab")}</span>
                <div className="sidebar-version">
                    <span className="sidebar-version-label" title={backendVersion && backendVersion !== FRONTEND_VERSION ? t("sidebar.versionDetails", { frontend: displayVersion(FRONTEND_VERSION), backend: displayVersion(backendVersion) }) : undefined}>{displayVersion(FRONTEND_VERSION)}{backendVersion && backendVersion !== FRONTEND_VERSION ? t("sidebar.backendVersion", { version: displayVersion(backendVersion) }) : ""}</span>
                    <span className="sidebar-documentation-group">
                        <span aria-hidden="true">·</span>
                        <a className="sidebar-documentation" href={documentationUrl} target="_blank" rel="noopener noreferrer" aria-describedby={newTabDescriptionId}>{t("sidebar.documentation")}</a>
                    </span>
                </div>
            </div>
        </aside>
    );
}

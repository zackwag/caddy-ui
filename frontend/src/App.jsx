import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import CaddyFile from "./components/CaddyFile.jsx";
import { ConfirmDialog, useConfirm } from "./components/Confirm.jsx";
import Dashboard from "./components/Dashboard.jsx";
import Login from "./components/Login.jsx";
import Logs from "./components/Logs.jsx";
import Metrics from "./components/Metrics.jsx";
import Instances from "./components/Instances.jsx";
import Notifications from "./components/Notifications.jsx";
import RoutesPage from "./components/Routes.jsx";
import Sidebar from "./components/Sidebar.jsx";
import ThemePicker from "./components/ThemePicker.jsx";
import ThemeWelcome from "./components/ThemeWelcome.jsx";
import TLS from "./components/TLS.jsx";
import { Toasts, useToast } from "./components/Toasts.jsx";
import { css, THEME_LIST } from "./styles.js";
import { API, apiFetch, fetchSettings, getAuthEnabled, getInstanceId, getToken, saveSettings, setAuthEnabled, setToken } from "./utils/api.js";

const VALID_THEME_IDS = new Set(THEME_LIST.map(t => t.id));

const DEFAULTS = {
    firstTimeRun: true,
    theme: 'dark',
    darkPalette: 'vt2026',
    lightPalette: 'coarse-everywhere',
    routeColumns: { status: true, title: true, upstream: true, server: true, id: true },
};

const TITLES = {
    "/dashboard": "Dashboard",
    "/caddyfile": "Caddyfile Editor",
    "/routes": "Route Manager",
    "/tls": "TLS Certificates",
    "/logs": "Access Logs",
    "/metrics": "Metrics",
    "/notifications": "Notifications",
    "/instances": "Instances",
};

export default function App() {
    const location = useLocation();
    const navigate = useNavigate();
    const [status, setStatus] = useState(null);
    const [noInstances, setNoInstances] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [instanceKey, setInstanceKey] = useState(getInstanceId);
    const [instanceListVersion, setInstanceListVersion] = useState(0);
    const [authEnabled, setAuthEnabledState] = useState(false);
    const [authed, setAuthed] = useState(() => {
        const cached = getAuthEnabled();
        if (cached === null) return null;
        return !cached || !!getToken();
    });
    const [sessionExpired, setSessionExpired] = useState(false);
    const [theme, setTheme] = useState(DEFAULTS.theme);
    const [darkPalette, setDarkPalette] = useState(DEFAULTS.darkPalette);
    const [lightPalette, setLightPalette] = useState(DEFAULTS.lightPalette);
    const [routeColumns, setRouteColumns] = useState(DEFAULTS.routeColumns);
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [showThemeWelcome, setShowThemeWelcome] = useState(false);
    const toast = useToast();
    const { dialog: confirmDialog, confirm, resolve: resolveConfirm } = useConfirm();

    const onUnauth = useCallback(() => {
        const wasAuthed = !!getToken();
        setToken(null);
        setAuthed(false);
        if (wasAuthed) setSessionExpired(true);
    }, []);

    useEffect(() => {
        if (!authed || settingsLoaded) return;
        fetchSettings(onUnauth).then(s => {
            const dk = VALID_THEME_IDS.has(s.darkPalette) ? s.darkPalette : DEFAULTS.darkPalette;
            const lt = VALID_THEME_IDS.has(s.lightPalette) ? s.lightPalette : DEFAULTS.lightPalette;
            setTheme(s.theme === 'light' ? 'light' : 'dark');
            setDarkPalette(dk);
            setLightPalette(lt);
            setRouteColumns({ ...DEFAULTS.routeColumns, ...s.routeColumns });
            setSettingsLoaded(true);
            if (s.firstTimeRun) setShowThemeWelcome(true);
        }).catch(() => {
            setSettingsLoaded(true);
        });
    }, [authed, settingsLoaded, onUnauth]);

    useEffect(() => {
        if (theme === 'light') document.documentElement.classList.add('light');
        else document.documentElement.classList.remove('light');
        document.documentElement.setAttribute('data-palette', theme === 'dark' ? darkPalette : lightPalette);
    }, [theme, darkPalette, lightPalette]);

    const persistSettings = useCallback((updates) => {
        saveSettings(updates, onUnauth).catch(() => {});
    }, [onUnauth]);

    const changeDarkPalette = (id) => { setDarkPalette(id); persistSettings({ darkPalette: id }); };
    const changeLightPalette = (id) => { setLightPalette(id); persistSettings({ lightPalette: id }); };
    const changeRouteColumns = (cols) => { setRouteColumns(cols); persistSettings({ routeColumns: cols }); };

    const handleThemeWelcome = (dark, light) => {
        setDarkPalette(dark);
        setLightPalette(light);
        setShowThemeWelcome(false);
        persistSettings({ firstTimeRun: false, darkPalette: dark, lightPalette: light });
    };

    const toggleTheme = () => {
        setTheme(t => {
            const next = t === 'dark' ? 'light' : 'dark';
            persistSettings({ theme: next });
            return next;
        });
    };

    useEffect(() => {
        fetch(`${API}/auth/status`)
            .then(r => r.json())
            .then(d => {
                setAuthEnabled(d.authEnabled);
                setAuthEnabledState(d.authEnabled);
                setAuthed(!d.authEnabled || !!getToken());
            })
            .catch(() => setAuthed(true));
    }, []);

    const fetchStatus = useCallback(() => {
        apiFetch("/status", {}, onUnauth).then((s) => {
            setStatus(s);
            setNoInstances(false);
        }).catch((err) => {
            if (err.code === 'NO_INSTANCES') {
                setNoInstances(true);
                setStatus(null);
                navigate('/instances', { replace: true });
            } else {
                setStatus({ online: false, error: "Could not reach backend" });
            }
        });
    }, [onUnauth, navigate]);

    useEffect(() => {
        if (!authed) return;
        fetchStatus();
        const t = setInterval(fetchStatus, 15000);
        return () => clearInterval(t);
    }, [authed, fetchStatus, instanceKey]);

    const handleInstanceChange = useCallback((id) => {
        if (id) {
            setInstanceKey(id);
            navigate('/dashboard', { replace: true });
        }
        setInstanceListVersion(v => v + 1);
        setNoInstances(false);
        setStatus(null);
        fetchStatus();
    }, [fetchStatus, navigate]);

    const basePath = '/' + location.pathname.split('/')[1];
    const title = TITLES[basePath] || "Dashboard";

    return (
        <>
            <style>{css}</style>
            {authed === null ? null : !authed ? (
                <Login onLogin={() => { setAuthed(true); setSessionExpired(false); }} sessionExpired={sessionExpired} />
            ) : (
                <div className="shell">
                    <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />

                    <Sidebar
                        currentPath={basePath}
                        status={status}
                        onRefreshStatus={fetchStatus}
                        authEnabled={authEnabled}
                        onUnauth={onUnauth}
                        sidebarOpen={sidebarOpen}
                        setSidebarOpen={setSidebarOpen}
                        selectedInstanceId={instanceKey}
                        onInstanceChange={handleInstanceChange}
                        instanceListVersion={instanceListVersion}
                    />

                    <div className="main">
                        <div className="topbar">
                            <div className="topbar-left">
                                <button className="hamburger" onClick={() => setSidebarOpen(o => !o)}>☰</button>
                                <span className="page-title">{title}</span>
                            </div>
                            <div className="btn-row">
                                <ThemePicker
                                    mode={theme}
                                    onToggleMode={toggleTheme}
                                    darkPalette={darkPalette}
                                    lightPalette={lightPalette}
                                    onDarkPaletteChange={changeDarkPalette}
                                    onLightPaletteChange={changeLightPalette}
                                />
                            </div>
                        </div>
                        <div className="content" key={instanceKey}>
                            <Routes>
                                <Route path="/" element={<Navigate to={noInstances ? "/instances" : "/dashboard"} replace />} />
                                <Route path="/dashboard" element={<Dashboard status={status} toast={toast} onUnauth={onUnauth} />} />
                                <Route path="/caddyfile" element={<CaddyFile toast={toast} onUnauth={onUnauth} theme={theme} confirm={confirm} />} />
                                <Route path="/routes" element={<RoutesPage toast={toast} onUnauth={onUnauth} confirm={confirm} theme={theme} routeColumns={routeColumns} onRouteColumnsChange={changeRouteColumns} />} />
                                <Route path="/tls" element={<TLS toast={toast} onUnauth={onUnauth} confirm={confirm} />} />
                                <Route path="/logs" element={<Logs toast={toast} onUnauth={onUnauth} />} />
                                <Route path="/metrics" element={<Metrics toast={toast} onUnauth={onUnauth} />} />
                                <Route path="/notifications" element={<Notifications toast={toast} onUnauth={onUnauth} />} />
                                <Route path="/instances" element={<Instances toast={toast} onUnauth={onUnauth} confirm={confirm} onInstanceChange={handleInstanceChange} />} />
                                <Route path="*" element={<Navigate to="/dashboard" replace />} />
                            </Routes>
                        </div>
                    </div>
                    <Toasts toasts={toast.toasts} />
                    <ConfirmDialog dialog={confirmDialog} resolve={resolveConfirm} />
                    {showThemeWelcome && <ThemeWelcome onComplete={handleThemeWelcome} />}
                </div>
            )}
        </>
    );
}

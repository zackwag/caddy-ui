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
import TLS from "./components/TLS.jsx";
import { Toasts, useToast } from "./components/Toasts.jsx";
import { css } from "./styles.js";
import { API, apiFetch, getAuthEnabled, getInstanceId, getTheme, getToken, saveTheme, setAuthEnabled, setToken } from "./utils/api.js";

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
    const [theme, setTheme] = useState(getTheme);
    const toast = useToast();
    const { dialog: confirmDialog, confirm, resolve: resolveConfirm } = useConfirm();

    const onUnauth = useCallback(() => {
        const wasAuthed = !!getToken();
        setToken(null);
        setAuthed(false);
        if (wasAuthed) setSessionExpired(true);
    }, []);

    useEffect(() => {
        if (theme === 'light') document.documentElement.classList.add('light');
        else document.documentElement.classList.remove('light');
        saveTheme(theme);
    }, [theme]);

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
        if (id) setInstanceKey(id);
        setInstanceListVersion(v => v + 1);
        setNoInstances(false);
        setStatus(null);
        fetchStatus();
    }, [fetchStatus]);

    const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

    // Current path without query string for title lookup
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
                                <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                                    {theme === 'dark' ? '☀︎' : '☾︎'}
                                </button>
                            </div>
                        </div>
                        <div className="content" key={instanceKey}>
                            <Routes>
                                <Route path="/" element={<Navigate to={noInstances ? "/instances" : "/dashboard"} replace />} />
                                <Route path="/dashboard" element={<Dashboard status={status} toast={toast} onUnauth={onUnauth} />} />
                                <Route path="/caddyfile" element={<CaddyFile toast={toast} onUnauth={onUnauth} theme={theme} confirm={confirm} />} />
                                <Route path="/routes" element={<RoutesPage toast={toast} onUnauth={onUnauth} confirm={confirm} theme={theme} />} />
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
                </div>
            )}
        </>
    );
}

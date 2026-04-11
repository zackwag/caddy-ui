import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import CaddyFile from "./components/CaddyFile.jsx";
import Dashboard from "./components/Dashboard.jsx";
import Login from "./components/Login.jsx";
import Logs from "./components/Logs.jsx";
import Metrics from "./components/Metrics.jsx";
import RoutesPage from "./components/Routes.jsx";
import Sidebar from "./components/Sidebar.jsx";
import TLS from "./components/TLS.jsx";
import { Toasts, useToast } from "./components/Toasts.jsx";
import { css } from "./styles.js";
import { API, apiFetch, getTheme, getToken, saveTheme, setToken } from "./utils/api.js";

const TITLES = {
    "/dashboard": "Dashboard",
    "/caddyfile": "Caddyfile Editor",
    "/routes": "Route Manager",
    "/tls": "TLS Certificates",
    "/logs": "Access Logs",
    "/metrics": "Metrics",
};

export default function App() {
    const location = useLocation();
    const navigate = useNavigate();
    const [status, setStatus] = useState(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [authEnabled, setAuthEnabled] = useState(false);
    const [authed, setAuthed] = useState(!!getToken());
    const [sessionExpired, setSessionExpired] = useState(false);
    const [theme, setTheme] = useState(getTheme);
    const toast = useToast();

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

    // Current path without query string for title lookup
    const basePath = '/' + location.pathname.split('/')[1];
    const title = TITLES[basePath] || "Dashboard";

    return (
        <>
            <style>{css}</style>
            {!authed ? (
                <Login onLogin={() => { setAuthed(true); setSessionExpired(false); }} sessionExpired={sessionExpired} />
            ) : (
                <div className="shell">
                    <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />

                    <Sidebar
                        currentPath={basePath}
                        status={status}
                        authEnabled={authEnabled}
                        onUnauth={onUnauth}
                        sidebarOpen={sidebarOpen}
                        setSidebarOpen={setSidebarOpen}
                    />

                    <div className="main">
                        <div className="topbar">
                            <div className="topbar-left">
                                <button className="hamburger" onClick={() => setSidebarOpen(o => !o)}>☰</button>
                                <span className="page-title">{title}</span>
                            </div>
                            <div className="btn-row">
                                <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                                    {theme === 'dark' ? '☀' : '☾'}
                                </button>
                                <button className="btn btn-ghost btn--sm" onClick={fetchStatus}>↺ Status</button>
                            </div>
                        </div>
                        <div className="content">
                            <Routes>
                                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                                <Route path="/dashboard" element={<Dashboard status={status} toast={toast} onUnauth={onUnauth} />} />
                                <Route path="/caddyfile" element={<CaddyFile toast={toast} onUnauth={onUnauth} theme={theme} />} />
                                <Route path="/routes" element={<RoutesPage toast={toast} onUnauth={onUnauth} />} />
                                <Route path="/tls" element={<TLS toast={toast} onUnauth={onUnauth} />} />
                                <Route path="/logs" element={<Logs toast={toast} onUnauth={onUnauth} />} />
                                <Route path="/metrics" element={<Metrics toast={toast} onUnauth={onUnauth} />} />
                                <Route path="*" element={<Navigate to="/dashboard" replace />} />
                            </Routes>
                        </div>
                    </div>
                    <Toasts toasts={toast.toasts} />
                </div>
            )}
        </>
    );
}

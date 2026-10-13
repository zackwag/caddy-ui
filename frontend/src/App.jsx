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
import LanguagePicker from "./components/LanguagePicker.jsx";
import { fetchEnabledLanguages, loadLocale, resolveLocale } from "./i18n/index.js";
import ThemeWelcome from "./components/ThemeWelcome.jsx";
import TLS from "./components/TLS.jsx";
import { Toasts, useToast } from "./components/Toasts.jsx";
import { css, THEME_LIST, THEME_VAR_KEYS } from "./styles.js";
import { API, apiFetch, fetchCustomThemes, fetchSettings, getAuthEnabled, getInstanceId, getToken, saveSettings, setAuthEnabled, setToken } from "./utils/api.js";
import { useTranslation } from 'react-i18next';

const DEFAULTS = {
    firstTimeRun: true,
    theme: 'dark',
    language: null,
    darkPalette: 'vt2026',
    lightPalette: 'coarse-everywhere',
    routeColumns: { status: true, title: true, upstream: true, server: true, id: true },
    routeChecks: false,
    routeCheckExcludes: [],
};

const TITLE_KEYS = {
    '/dashboard': 'pages.dashboard',
    '/caddyfile': 'pages.caddyfile',
    '/routes': 'pages.routes',
    '/tls': 'pages.tls',
    '/logs': 'pages.logs',
    '/metrics': 'pages.metrics',
    '/notifications': 'pages.notifications',
    '/instances': 'pages.instances',
};

export default function App() {
    const { t } = useTranslation();
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
    const [language, setLanguage] = useState(DEFAULTS.language);
    const [enabledLanguages, setEnabledLanguages] = useState(['en']);
    const [languageReady, setLanguageReady] = useState(false);
    const [theme, setTheme] = useState(DEFAULTS.theme);
    const [darkPalette, setDarkPalette] = useState(DEFAULTS.darkPalette);
    const [lightPalette, setLightPalette] = useState(DEFAULTS.lightPalette);
    const [routeColumns, setRouteColumns] = useState(DEFAULTS.routeColumns);
    const [routeChecks, setRouteChecks] = useState(DEFAULTS.routeChecks);
    const [routeCheckExcludes, setRouteCheckExcludes] = useState(DEFAULTS.routeCheckExcludes);
    const [customThemes, setCustomThemes] = useState([]);
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
        let cancelled = false;

        async function bootstrapLanguage() {
            try {
                const enabled = await fetchEnabledLanguages();
                const resolved = resolveLocale(enabled, null);

                await loadLocale(resolved);

                if (cancelled) return;

                setEnabledLanguages(enabled);
                setLanguage(resolved);
            } catch {
                await loadLocale('en');

                if (cancelled) return;

                setEnabledLanguages(['en']);
                setLanguage('en');
            } finally {
                if (!cancelled) setLanguageReady(true);
            }
        }

        bootstrapLanguage();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!authed || !languageReady || settingsLoaded) return;
        Promise.all([
            fetchSettings(onUnauth),
            fetchCustomThemes(onUnauth).catch(() => []),
        ]).then(([s, custom]) => {
            setCustomThemes(custom);
            const validIds = new Set([...THEME_LIST, ...custom].map(t => t.id));
            const dk = validIds.has(s.darkPalette) ? s.darkPalette : DEFAULTS.darkPalette;
            const lt = validIds.has(s.lightPalette) ? s.lightPalette : DEFAULTS.lightPalette;
            setTheme(s.theme === 'light' ? 'light' : 'dark');
            setDarkPalette(dk);
            setLightPalette(lt);
            setRouteColumns({ ...DEFAULTS.routeColumns, ...s.routeColumns });
            setRouteChecks(s.routeChecks === true);
            setRouteCheckExcludes(Array.isArray(s.routeCheckExcludes) ? s.routeCheckExcludes : []);
            setSettingsLoaded(true);
            if (s.firstTimeRun) setShowThemeWelcome(true);

            // Applied last so a locale chunk that fails to load (e.g. a stale
            // hash after a redeploy) leaves the UI in its current language
            // instead of discarding the rest of the settings.
            const resolvedLanguage = resolveLocale(enabledLanguages, s.language ?? null);
            loadLocale(resolvedLanguage).then(() => setLanguage(resolvedLanguage)).catch(() => {});
        }).catch(() => {
            setSettingsLoaded(true);
        });
    }, [authed, languageReady, settingsLoaded, enabledLanguages, onUnauth]);

    const allThemes = [...THEME_LIST, ...customThemes];

    useEffect(() => {
        if (theme === 'light') document.documentElement.classList.add('light');
        else document.documentElement.classList.remove('light');
        const activeId = theme === 'dark' ? darkPalette : lightPalette;
        document.documentElement.setAttribute('data-palette', activeId);

        // Custom themes aren't in the static stylesheet, so apply their
        // variables directly; inline styles beat any [data-palette] rule
        // on specificity. Clear them when switching back to a built-in so
        // a stale custom color doesn't linger.
        const active = customThemes.find(t => t.id === activeId);
        for (const key of THEME_VAR_KEYS) {
            if (active) document.documentElement.style.setProperty(key, active.vars[key]);
            else document.documentElement.style.removeProperty(key);
        }
    }, [theme, darkPalette, lightPalette, customThemes]);

    const persistSettings = useCallback((updates) => {
        saveSettings(updates, onUnauth).catch(() => {});
    }, [onUnauth]);

    const changeLanguage = async (lang) => {
        if (!enabledLanguages.includes(lang)) return;

        try {
            await loadLocale(lang);
        } catch {
            toast.error(t('errors.languageLoadFailed'));
            return;
        }
        setLanguage(lang);
        persistSettings({ language: lang });
    };

    const changeDarkPalette = (id) => { setDarkPalette(id); persistSettings({ darkPalette: id }); };
    const changeLightPalette = (id) => { setLightPalette(id); persistSettings({ lightPalette: id }); };
    const changeRouteColumns = (cols) => { setRouteColumns(cols); persistSettings({ routeColumns: cols }); };
    const changeRouteChecks = (enabled) => { setRouteChecks(enabled); persistSettings({ routeChecks: enabled }); };
    const changeRouteCheckExcludes = (hosts) => { setRouteCheckExcludes(hosts); persistSettings({ routeCheckExcludes: hosts }); };

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
            } else {
                // Translated at render time so switching languages doesn't
                // recreate this callback and re-poll /status.
                setStatus({ online: false, errorKey: 'errors.backendUnreachable' });
            }
        });
    }, [onUnauth]);

    // caddy/ui logs dont depend on instance, so Logs stays reachable alongside Instances.
    useEffect(() => {
        const path = '/' + location.pathname.split('/')[1];
        if (noInstances && path !== '/logs' && path !== '/instances') navigate('/instances', { replace: true });
    }, [noInstances, location.pathname, navigate]);

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
    const title = t(TITLE_KEYS[basePath] || 'pages.dashboard');

    return (
        <>
            <style>{css}</style>
            {authed === null || !languageReady ? null : !authed ? (
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
                                {language && enabledLanguages.length > 1 && (
                                    <LanguagePicker
                                        languages={enabledLanguages}
                                        language={language}
                                        onLanguageChange={changeLanguage}
                                    />
                                )}
                                <ThemePicker
                                    themes={allThemes}
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
                                <Route path="/routes" element={<RoutesPage toast={toast} onUnauth={onUnauth} confirm={confirm} theme={theme} routeColumns={routeColumns} onRouteColumnsChange={changeRouteColumns} routeChecks={routeChecks} routeCheckExcludes={routeCheckExcludes} />} />
                                <Route path="/tls" element={<TLS toast={toast} onUnauth={onUnauth} confirm={confirm} />} />
                                <Route path="/logs" element={<Logs toast={toast} onUnauth={onUnauth} noInstances={noInstances} />} />
                                <Route path="/metrics" element={<Metrics toast={toast} onUnauth={onUnauth} routeChecks={routeChecks} onRouteChecksChange={changeRouteChecks} routeCheckExcludes={routeCheckExcludes} onRouteCheckExcludesChange={changeRouteCheckExcludes} />} />
                                <Route path="/notifications" element={<Notifications toast={toast} onUnauth={onUnauth} />} />
                                <Route path="/instances" element={<Instances toast={toast} onUnauth={onUnauth} confirm={confirm} onInstanceChange={handleInstanceChange} />} />
                                <Route path="*" element={<Navigate to="/dashboard" replace />} />
                            </Routes>
                        </div>
                    </div>
                    <Toasts toasts={toast.toasts} />
                    <ConfirmDialog dialog={confirmDialog} resolve={resolveConfirm} />
                    {showThemeWelcome && <ThemeWelcome themes={allThemes} languages={enabledLanguages} language={language} onLanguageChange={changeLanguage} onComplete={handleThemeWelcome} />}
                </div>
            )}
        </>
    );
}

import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import CaddyFile from "./components/CaddyFile.jsx";
import { UtilityIcon } from "./components/Icons.jsx";
import { ConfirmDialog, useConfirm } from "./components/Confirm.jsx";
import Dashboard from "./components/Dashboard.jsx";
import Login from "./components/Login.jsx";
import LoginCard, { LoginLogo } from "./components/LoginCard.jsx";
import SecuritySettings from './components/SecuritySettings.jsx';
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
import { STATUS_INTERVAL_MS, usePoll } from "./hooks/usePoll.js";
import { css, DEFAULT_PALETTES, THEME_LIST, THEME_VAR_KEYS } from "./styles.js";
import { apiFetch, authRequest, fetchAuthStatus, getInstanceId, onInstanceSelectionReset, onUnauthorized, resetAuthContext, setInstanceId } from "./utils/api.js";
import { viewAt } from "./views.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { useTranslation } from 'react-i18next';


export default function App() {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const [status, setStatus] = useState(null);
    const [noInstances, setNoInstances] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [instanceKey, setInstanceKey] = useState(getInstanceId);
    // The configured instances, null until loaded; the error is kept until a load succeeds
    const [instances, setInstances] = useState(null);
    const [instancesError, setInstancesError] = useState(null);
    const [authState, setAuthState] = useState(null);
    const [authError, setAuthError] = useState(false);
    const [showSecurity, setShowSecurity] = useState(false);
    const authed = Boolean(authState?.authenticated);
    const [sessionExpired, setSessionExpired] = useState(false);
    const [language, setLanguage] = useState(null);
    const [enabledLanguages, setEnabledLanguages] = useState(['en']);
    const [languageReady, setLanguageReady] = useState(false);
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [customThemes, setCustomThemes] = useState([]);
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [showThemeWelcome, setShowThemeWelcome] = useState(false);
    const { toast, toasts } = useToast();
    const { dialog: confirmDialog, confirm, resolve: resolveConfirm } = useConfirm();

    const signedOut = useCallback(() => {
        setShowSecurity(false);
        resetAuthContext();
        setAuthState(previous => previous ? { ...previous, authenticated: false } : null);
        setSettingsLoaded(false);
        setSessionExpired(true);
    }, []);

    // Only while signed in: a refused sign-in is not an expired session
    useEffect(() => authed ? onUnauthorized(signedOut) : undefined, [authed, signedOut]);

    const refreshAuth = useCallback(async () => {
        setAuthError(false);
        try {
            const state = await fetchAuthStatus();
            setAuthState(state);
            setSessionExpired(false);
        } catch {
            setAuthState(null);
            setAuthError(true);
        }
    }, []);

    const logout = async () => {
        try {
            await authRequest('/sessions/current', { method: 'DELETE' });
            signedOut();
            await refreshAuth();
        } catch (error) { toast.error(error); }
    };

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
            apiFetch('/settings'),
            apiFetch('/custom-themes').catch(() => []),
        ]).then(([s, custom]) => {
            setCustomThemes(custom);
            const validIds = new Set([...THEME_LIST, ...custom].map(t => t.id));
            const palette = (id, fallback) => validIds.has(id) ? id : fallback;
            setSettings({ ...DEFAULT_SETTINGS, ...s, darkPalette: palette(s.darkPalette, DEFAULT_PALETTES.dark), lightPalette: palette(s.lightPalette, DEFAULT_PALETTES.light) });
            setSettingsLoaded(true);
            if (s.firstTimeRun) setShowThemeWelcome(true);

            // Applied last so a locale chunk that fails to load (e.g. a stale
            // hash after a redeploy) leaves the UI in its current language
            // instead of discarding the rest of the settings.
            const resolvedLanguage = resolveLocale(enabledLanguages, s.language ?? null);
            loadLocale(resolvedLanguage).then(() => setLanguage(resolvedLanguage)).catch(() => {});
        }).catch(error => {
            toast.error(error);
            setSettingsLoaded(true);
        });
    }, [authed, languageReady, settingsLoaded, enabledLanguages, toast]);

    const { theme, darkPalette, lightPalette } = settings;
    const allThemes = [...THEME_LIST, ...customThemes];

    useEffect(() => {
        document.documentElement.classList.toggle('light', theme === 'light');
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

    // Shown right away and then saved; the saved value wins on the next load.
    const updateSettings = (updates) => {
        setSettings(previous => ({ ...previous, ...updates }));
        apiFetch('/settings', { method: 'PUT', json: updates }).catch(toast.error);
    };

    const changeLanguage = async (lang) => {
        if (!enabledLanguages.includes(lang)) return;

        try {
            await loadLocale(lang);
        } catch {
            toast.failure(t('errors.languageLoadFailed'));
            return;
        }
        setLanguage(lang);
        updateSettings({ language: lang });
    };

    const completeWelcome = ({ dark, light }) => {
        setShowThemeWelcome(false);
        updateSettings({ firstTimeRun: false, darkPalette: dark, lightPalette: light });
    };

    useEffect(() => {
        resetAuthContext();
        refreshAuth();
    }, [refreshAuth]);

    const fetchStatus = useCallback(() => {
        apiFetch("/status").then((s) => {
            setStatus(s);
            setNoInstances(false);
        }).catch((err) => {
            if (err.code === 'NO_INSTANCES') {
                setNoInstances(true);
                setStatus(null);
            } else {
                setStatus({ online: false, code: err.code });
            }
        });
    }, []);

    const view = viewAt(location.pathname);

    useEffect(() => {
        if (noInstances && view.needsInstance) navigate('/instances', { replace: true });
    }, [noInstances, view, navigate]);

    usePoll(authed ? fetchStatus : null, STATUS_INTERVAL_MS);

    const loadInstances = useCallback(() => {
        apiFetch("/instances")
            .then(list => { setInstancesError(null); setInstances(list); })
            .catch(setInstancesError);
    }, []);

    useEffect(() => {
        if (authed) {
            loadInstances();
        }
    }, [authed, loadInstances]);

    const refreshInstances = useCallback(() => {
        toast.clearStates();
        loadInstances();
        setNoInstances(false);
        setStatus(null);
        fetchStatus();
    }, [fetchStatus, loadInstances, toast]);

    const switchInstance = (id) => {
        setInstanceId(id);
        setInstanceKey(id);
        navigate('/dashboard', { replace: true });
        refreshInstances();
    };

    // The stored selection was dropped (instance deleted or unknown); remount
    // views on the fallback instance without leaving the current page.
    useEffect(() => onInstanceSelectionReset(() => {
        setInstanceKey(getInstanceId());
        refreshInstances();
    }), [refreshInstances]);

    return (
        <>
            <style>{css}</style>
            {!languageReady ? null : authError ? (
                <LoginCard>
                    <LoginLogo />
                    <p className="login-error" role="alert">{t('login.serverUnreachable')}</p>
                    <button className="btn btn-primary btn--full" onClick={refreshAuth}>{t('login.retry')}</button>
                </LoginCard>
            ) : !authState ? null : !authed ? (
                <Login authState={authState} onLogin={refreshAuth} sessionExpired={sessionExpired} />
            ) : (
                <div className="shell">
                    <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />

                    <Sidebar
                        currentPath={view.path}
                        status={status}
                        onRefreshStatus={fetchStatus}
                        onLogout={logout}
                        onSecurity={() => { setSidebarOpen(false); loadInstances(); setShowSecurity(true); }}
                        sidebarOpen={sidebarOpen}
                        setSidebarOpen={setSidebarOpen}
                        selectedInstanceId={instanceKey}
                        onSwitchInstance={switchInstance}
                        instances={instances}
                    />

                    <div className="main">
                        <div className="topbar">
                            <div className="topbar-left">
                                <button className="hamburger" onClick={() => setSidebarOpen(o => !o)} aria-label={t("sidebar.toggleNavigation")} aria-expanded={sidebarOpen}><UtilityIcon name="menu" size={18} /></button>
                                <span className="page-title">{t(view.titleKey)}</span>
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
                                    onToggleMode={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
                                    darkPalette={darkPalette}
                                    lightPalette={lightPalette}
                                    onDarkPaletteChange={id => updateSettings({ darkPalette: id })}
                                    onLightPaletteChange={id => updateSettings({ lightPalette: id })}
                                />
                            </div>
                        </div>
                        <div className="content" key={instanceKey}>
                            <Routes>
                                <Route path="/" element={<Navigate to={noInstances ? "/instances" : "/dashboard"} replace />} />
                                <Route path="/dashboard" element={<Dashboard status={status} toast={toast} />} />
                                <Route path="/caddyfile" element={<CaddyFile toast={toast} theme={theme} confirm={confirm} editorVim={settings.editorVim} onEditorVimChange={editorVim => updateSettings({ editorVim })} />} />
                                <Route path="/routes" element={<RoutesPage toast={toast} confirm={confirm} theme={theme} routeColumns={settings.routeColumns} onRouteColumnsChange={routeColumns => updateSettings({ routeColumns })} routeChecks={settings.routeChecks} routeCheckExcludes={settings.routeCheckExcludes} editorVim={settings.editorVim} />} />
                                <Route path="/tls" element={<TLS toast={toast} confirm={confirm} />} />
                                <Route path="/logs" element={<Logs toast={toast} noInstances={noInstances} />} />
                                <Route path="/metrics" element={<Metrics toast={toast} publicMetrics={authState.publicMetrics} routeChecks={settings.routeChecks} onRouteChecksChange={routeChecks => updateSettings({ routeChecks })} routeCheckExcludes={settings.routeCheckExcludes} onRouteCheckExcludesChange={routeCheckExcludes => updateSettings({ routeCheckExcludes })} />} />
                                <Route path="/notifications" element={<Notifications toast={toast} />} />
                                <Route path="/instances" element={<Instances toast={toast} confirm={confirm} onInstancesChange={refreshInstances} />} />
                                <Route path="*" element={<Navigate to="/dashboard" replace />} />
                            </Routes>
                        </div>
                    </div>
                    <Toasts toasts={toasts} />
                    <ConfirmDialog dialog={confirmDialog} resolve={resolveConfirm} />
                    {showSecurity && <SecuritySettings instances={instances} instancesError={instancesError} onClose={() => setShowSecurity(false)} />}
                    {showThemeWelcome && <ThemeWelcome themes={allThemes} languages={enabledLanguages} language={language} onLanguageChange={changeLanguage} onComplete={completeWelcome} />}
                </div>
            )}
        </>
    );
}

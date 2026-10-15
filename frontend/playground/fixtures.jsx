import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../src/components/Confirm.jsx';
import { Toasts, useToast } from '../src/components/Toasts.jsx';
import Dashboard from '../src/components/Dashboard.jsx';
import Login from '../src/components/Login.jsx';
import ThemeWelcome from '../src/components/ThemeWelcome.jsx';
import ThemePicker from '../src/components/ThemePicker.jsx';
import LanguagePicker from '../src/components/LanguagePicker.jsx';
import Notifications from '../src/components/Notifications.jsx';
import { availableLocales } from '../src/i18n/index.js';
import { THEME_LIST } from '../src/styles.js';
import { apiFetch } from '../src/utils/api.js';
import { localizeError } from '../src/utils/errorMessages.js';

const noop = () => {};

export function RouteConfirmation() {
    const { t } = useTranslation();
    return (
        <ConfirmDialog
            dialog={{
                message: t('routes.deleteConfirm'),
                danger: true,
                confirmLabel: t('common.delete'),
                cancelLabel: t('common.cancel'),
            }}
            resolve={noop}
        />
    );
}

export function CertificateConfirmation() {
    const { t } = useTranslation();
    return (
        <ConfirmDialog
            dialog={{
                message: t('tls.deleteConfirm', { status: 'expired', domain: 'example.home.arpa' }),
                danger: true,
                confirmLabel: t('common.delete'),
                cancelLabel: t('common.cancel'),
            }}
            resolve={noop}
        />
    );
}

export function NotificationToast() {
    const { t } = useTranslation();
    return <Toasts toasts={[{ id: 1, type: 'success', msg: t('notifications.saved') }]} />;
}

function DashboardFixture({ loading }) {
    const [status, setStatus] = useState(null);
    const toast = useToast();
    const { error } = toast;
    const { t } = useTranslation();
    useEffect(() => {
        if (loading) return;
        let cancelled = false;
        apiFetch('/status').then(value => { if (!cancelled) setStatus(value); })
            .catch(e => { if (!cancelled) error(localizeError(e, t), e); });
        return () => { cancelled = true; };
    }, [loading, error, t]);
    return <><Dashboard status={loading ? null : status} toast={toast} onUnauth={noop} /><Toasts toasts={toast.toasts} /></>;
}

function ThemeWelcomeFixture() {
    const { i18n } = useTranslation();
    return <ThemeWelcome themes={THEME_LIST} languages={availableLocales} language={i18n.language}
        onLanguageChange={noop} onComplete={noop} />;
}

function AppearanceControlsFixture({ initialMode }) {
    const { i18n } = useTranslation();
    const [mode, setMode] = useState(initialMode);
    const [dark, setDark] = useState('vt2026');
    const [light, setLight] = useState('coarse-everywhere');
    return <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <LanguagePicker languages={availableLocales} language={i18n.language} onLanguageChange={noop} />
        <ThemePicker themes={THEME_LIST} mode={mode} onToggleMode={() => setMode(value => value === 'dark' ? 'light' : 'dark')}
            darkPalette={dark} lightPalette={light} onDarkPaletteChange={setDark} onLightPaletteChange={setLight} />
    </div>;
}

function NotificationSettingsFixture() {
    const toast = useToast();
    return <><Notifications toast={toast} onUnauth={noop} /><Toasts toasts={toast.toasts} /></>;
}

export default function FixtureView({ scenario }) {
    switch (scenario.kind) {
        case 'login': return <Login onLogin={noop} sessionExpired={scenario.sessionExpired} />;
        case 'theme-welcome': return <ThemeWelcomeFixture />;
        case 'appearance-controls': return <AppearanceControlsFixture initialMode={scenario.mode} />;
        case 'notification-settings': return <NotificationSettingsFixture />;
        case 'route-confirmation': return <RouteConfirmation />;
        case 'certificate-confirmation': return <CertificateConfirmation />;
        case 'notification-toast': return <NotificationToast />;
        case 'dashboard': return <DashboardFixture loading={scenario.loading} />;
        default: throw new Error(`No renderer for ${scenario.kind}`);
    }
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { ConfirmDialog, useConfirm } from '../../src/frontend/src/components/Confirm.jsx';
import { Toasts, useToast } from '../../src/frontend/src/components/Toasts.jsx';
import Dashboard from '../../src/frontend/src/components/Dashboard.jsx';
import Login from '../../src/frontend/src/components/Login.jsx';
import ThemeWelcome from '../../src/frontend/src/components/ThemeWelcome.jsx';
import ThemePicker from '../../src/frontend/src/components/ThemePicker.jsx';
import LanguagePicker from '../../src/frontend/src/components/LanguagePicker.jsx';
import Notifications from '../../src/frontend/src/components/Notifications.jsx';
import Metrics from '../../src/frontend/src/components/Metrics.jsx';
import Logs from '../../src/frontend/src/components/Logs.jsx';
import TLS from '../../src/frontend/src/components/TLS.jsx';
import Sidebar from '../../src/frontend/src/components/Sidebar.jsx';
import Routes from '../../src/frontend/src/components/Routes.jsx';
import RouteHistoryModal from '../../src/frontend/src/components/RouteHistoryModal.jsx';
import CaddyFile from '../../src/frontend/src/components/CaddyFile.jsx';
import Instances from '../../src/frontend/src/components/Instances.jsx';
import UpstreamUptime from '../../src/frontend/src/components/UpstreamUptime.jsx';
import { availableLocales } from '../../src/frontend/src/i18n/index.js';
import { THEME_LIST } from '../../src/frontend/src/styles.js';
import { apiFetch } from '../../src/frontend/src/utils/api.js';
import { localizeError } from '../../src/frontend/src/utils/errorMessages.js';

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

function MetricsFixture({ initialRouteChecks }) {
    const toast = useToast();
    const [routeChecks, setRouteChecks] = useState(Boolean(initialRouteChecks));
    const [excludes, setExcludes] = useState([]);
    return <><Metrics toast={toast} onUnauth={noop} routeChecks={routeChecks} onRouteChecksChange={setRouteChecks}
        routeCheckExcludes={excludes} onRouteCheckExcludesChange={setExcludes} /><Toasts toasts={toast.toasts} /></>;
}

function LogsFixture() {
    const toast = useToast();
    return <><Logs toast={toast} onUnauth={noop} /><Toasts toasts={toast.toasts} /></>;
}

function TLSFixture() {
    const toast = useToast();
    return <><TLS toast={toast} onUnauth={noop} confirm={async () => false} /><Toasts toasts={toast.toasts} /></>;
}

function SidebarFixture({ loading }) {
    const [status, setStatus] = useState(null);
    const [open, setOpen] = useState(true);
    const { pathname } = useLocation();
    useEffect(() => {
        if (loading) return;
        let cancelled = false;
        apiFetch('/status').then(value => { if (!cancelled) setStatus(value); });
        return () => { cancelled = true; };
    }, [loading]);
    // A finite shell gives the sidebar its normal flex layout without tying
    // its height to the iframe viewport that it is itself sizing.
    return <div className="shell" style={{ height: 640 }}>
        <Sidebar currentPath={pathname} status={status} onRefreshStatus={noop} authEnabled
            onUnauth={noop} sidebarOpen={open} setSidebarOpen={setOpen} selectedInstanceId="default" />
    </div>;
}

function RoutesFixture() {
    const toast = useToast();
    const [columns, setColumns] = useState({ status: true, title: true, upstream: true, server: true, id: true });
    return <><Routes toast={toast} onUnauth={noop} confirm={async () => false} theme="dark"
        routeColumns={columns} onRouteColumnsChange={setColumns} routeChecks={false} routeCheckExcludes={[]} />
        <Toasts toasts={toast.toasts} /></>;
}

function CaddyfileFixture() {
    const toast = useToast();
    const confirmation = useConfirm();
    return <><div style={{ height: 960 }}>
        <CaddyFile toast={toast} onUnauth={noop} theme="dark" confirm={confirmation.confirm} />
    </div><ConfirmDialog dialog={confirmation.dialog} resolve={confirmation.resolve} /><Toasts toasts={toast.toasts} /></>;
}

function InstancesFixture() {
    const toast = useToast();
    const confirmation = useConfirm();
    return <><Instances toast={toast} onUnauth={noop} confirm={confirmation.confirm} />
        <ConfirmDialog dialog={confirmation.dialog} resolve={confirmation.resolve} /><Toasts toasts={toast.toasts} /></>;
}

function UptimeFixture() {
    const [routeChecks, setRouteChecks] = useState(true);
    const [excludes, setExcludes] = useState([]);
    const toast = useToast();
    return <><UpstreamUptime toast={toast} onUnauth={noop} routeChecks={routeChecks} onRouteChecksChange={setRouteChecks}
        routeCheckExcludes={excludes} onRouteCheckExcludesChange={setExcludes} /><Toasts toasts={toast.toasts} /></>;
}

export default function FixtureView({ scenario }) {
    switch (scenario.kind) {
        case 'instances': return <InstancesFixture />;
        case 'tls-certificates': return <TLSFixture />;
        case 'uptime-populated': return <UptimeFixture />;
        case 'caddyfile': return <CaddyfileFixture />;
        case 'route-edit':
        case 'routes': return <RoutesFixture />;
        case 'route-history': return <RouteHistoryModal route="preview.home.arpa" onUnauth={noop} onClose={noop} />;
        case 'tls': return <TLSFixture />;
        case 'sidebar': return <SidebarFixture loading={scenario.loading} />;
        case 'login': return <Login onLogin={noop} sessionExpired={scenario.sessionExpired} />;
        case 'theme-welcome': return <ThemeWelcomeFixture />;
        case 'appearance-controls': return <AppearanceControlsFixture initialMode={scenario.mode} />;
        case 'notification-settings': return <NotificationSettingsFixture />;
        case 'metrics': return <MetricsFixture initialRouteChecks={scenario.routeChecks} />;
        case 'logs': return <LogsFixture />;
        case 'route-confirmation': return <RouteConfirmation />;
        case 'certificate-confirmation': return <CertificateConfirmation />;
        case 'notification-toast': return <NotificationToast />;
        case 'dashboard': return <DashboardFixture loading={scenario.loading} />;
        default: throw new Error(`No renderer for ${scenario.kind}`);
    }
}

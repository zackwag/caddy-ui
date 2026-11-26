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
import { DEFAULT_PALETTES, THEME_LIST } from '../../src/frontend/src/styles.js';
import { apiFetch } from '../../src/frontend/src/utils/api.js';

const noop = () => {};

function RouteConfirmation() {
    const { t } = useTranslation();
    return (
        <ConfirmDialog
            dialog={{
                message: t('routes.deleteConfirm'),
                danger: true,
                confirmLabel: t('common.delete'),
            }}
            resolve={noop}
        />
    );
}

function CertificateConfirmation() {
    const { t } = useTranslation();
    return (
        <ConfirmDialog
            dialog={{
                message: t('tls.deleteConfirm', { status: 'expired', domain: 'example.home.arpa' }),
                danger: true,
                confirmLabel: t('common.delete'),
            }}
            resolve={noop}
        />
    );
}

function NotificationToast() {
    const { t } = useTranslation();
    return <Toasts toasts={[{ id: 1, type: 'success', msg: t('notifications.saved') }]} />;
}

function DashboardFixture({ loading }) {
    const [status, setStatus] = useState(null);
    const { toast, toasts } = useToast();
    useEffect(() => {
        if (loading) return;
        let cancelled = false;
        apiFetch('/status').then(value => { if (!cancelled) setStatus(value); })
            .catch(e => { if (!cancelled) toast.error(e); });
        return () => { cancelled = true; };
    }, [loading, toast]);
    return <><Dashboard status={loading ? null : status} toast={toast} /><Toasts toasts={toasts} /></>;
}

function ThemeWelcomeFixture() {
    const { i18n } = useTranslation();
    return <ThemeWelcome themes={THEME_LIST} languages={availableLocales} language={i18n.language}
        onLanguageChange={noop} onComplete={noop} />;
}

function AppearanceControlsFixture({ initialMode }) {
    const { i18n } = useTranslation();
    const [mode, setMode] = useState(initialMode);
    const [dark, setDark] = useState(DEFAULT_PALETTES.dark);
    const [light, setLight] = useState(DEFAULT_PALETTES.light);
    return <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <LanguagePicker languages={availableLocales} language={i18n.language} onLanguageChange={noop} />
        <ThemePicker themes={THEME_LIST} mode={mode} onToggleMode={() => setMode(value => value === 'dark' ? 'light' : 'dark')}
            darkPalette={dark} lightPalette={light} onDarkPaletteChange={setDark} onLightPaletteChange={setLight} />
    </div>;
}

function NotificationSettingsFixture() {
    const { toast, toasts } = useToast();
    return <><Notifications toast={toast} /><Toasts toasts={toasts} /></>;
}

function MetricsFixture({ initialRouteChecks }) {
    const { toast, toasts } = useToast();
    const [routeChecks, setRouteChecks] = useState(Boolean(initialRouteChecks));
    const [excludes, setExcludes] = useState([]);
    return <><Metrics toast={toast} publicMetrics={false} routeChecks={routeChecks} onRouteChecksChange={setRouteChecks}
        routeCheckExcludes={excludes} onRouteCheckExcludesChange={setExcludes} /><Toasts toasts={toasts} /></>;
}

function LogsFixture() {
    const { toast, toasts } = useToast();
    return <><Logs toast={toast} /><Toasts toasts={toasts} /></>;
}

function TLSFixture() {
    const { toast, toasts } = useToast();
    return <><TLS toast={toast} confirm={async () => false} /><Toasts toasts={toasts} /></>;
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
        <Sidebar currentPath={pathname} status={status} onRefreshStatus={noop} onLogout={noop} onSecurity={noop} onSwitchInstance={noop}
            sidebarOpen={open} setSidebarOpen={setOpen} selectedInstanceId="default" />
    </div>;
}

function RoutesFixture() {
    const { toast, toasts } = useToast();
    const [columns, setColumns] = useState({ status: true, title: true, upstream: true, server: true, id: true });
    return <><Routes toast={toast} confirm={async () => false} theme="dark"
        routeColumns={columns} onRouteColumnsChange={setColumns} routeChecks={false} routeCheckExcludes={[]} />
        <Toasts toasts={toasts} /></>;
}

function CaddyfileFixture() {
    const { toast, toasts } = useToast();
    const confirmation = useConfirm();
    return <><div style={{ height: 960 }}>
        <CaddyFile toast={toast} theme="dark" confirm={confirmation.confirm} />
    </div><ConfirmDialog dialog={confirmation.dialog} resolve={confirmation.resolve} /><Toasts toasts={toasts} /></>;
}

function InstancesFixture() {
    const { toast, toasts } = useToast();
    const confirmation = useConfirm();
    return <><Instances toast={toast} confirm={confirmation.confirm} onInstancesChange={noop} />
        <ConfirmDialog dialog={confirmation.dialog} resolve={confirmation.resolve} /><Toasts toasts={toasts} /></>;
}

function UptimeFixture() {
    const [routeChecks, setRouteChecks] = useState(true);
    const [excludes, setExcludes] = useState([]);
    const { toast, toasts } = useToast();
    return <><UpstreamUptime toast={toast} routeChecks={routeChecks} onRouteChecksChange={setRouteChecks}
        routeCheckExcludes={excludes} onRouteCheckExcludesChange={setExcludes} /><Toasts toasts={toasts} /></>;
}

export default function FixtureView({ scenario }) {
    switch (scenario.kind) {
        case 'instances': return <InstancesFixture />;
        case 'uptime-populated': return <UptimeFixture />;
        case 'caddyfile': return <CaddyfileFixture />;
        case 'routes': return <RoutesFixture />;
        case 'route-history': return <RouteHistoryModal route="preview.home.arpa" onClose={noop} />;
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

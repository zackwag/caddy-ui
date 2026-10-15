import dashboardCapture from './captures/dashboard.json';
import { validateCapture } from './capture-format.js';

export const capture = validateCapture(dashboardCapture);

function dashboardKeys(profile) {
    const body = path => profile.requests.find(record => record.request.path === path)?.response.body;
    const status = body('/status');
    const process = body('/status/process');
    const health = body('/health');
    const keys = ['dashboard.status', 'dashboard.caddyServer', 'dashboard.servers', 'dashboard.activeHttpServers',
        'dashboard.tls', 'dashboard.certificateManagement', 'dashboard.upstreams', 'dashboard.process'];
    keys.push(status.online ? 'dashboard.online' : 'dashboard.offline');
    if (status.online) keys.push(status.tlsEnabled ? 'dashboard.enabled' : 'dashboard.disabled');
    else keys.push('dashboard.connectionError');
    if (Array.isArray(health)) keys.push('dashboard.allOnline');
    keys.push(...(process.ok
        ? ['dashboard.version', 'dashboard.uptime', 'dashboard.heap', 'dashboard.systemMemory', 'dashboard.lastReload']
        : ['dashboard.metricsNotEnabled', 'dashboard.enableInMetrics']));
    if (status.servers?.length) keys.push('dashboard.httpServers', 'dashboard.label', 'dashboard.serverId',
        'dashboard.serverIdHint', 'dashboard.listensOn', 'dashboard.routes', 'dashboard.active', 'dashboard.showRoutesOn', 'dashboard.editLabel');
    return keys;
}

const titles = { 'dashboard-online': 'Dashboard: running Caddy', 'dashboard-empty': 'Dashboard: no HTTP servers',
    'dashboard-stopped': 'Dashboard: stopped Caddy' };

const loginKeys = ['login.serverManager', 'login.username', 'login.password', 'login.signIn'];
const welcomeKeys = ['themeWelcome.title', 'themeWelcome.hint', 'themeWelcome.dark', 'themeWelcome.light',
    'themeWelcome.preview', 'themeWelcome.accent', 'themeWelcome.info', 'themeWelcome.highlight',
    'themeWelcome.danger', 'themeWelcome.warn', 'themeWelcome.language', 'themeWelcome.apply'];
const controlKeys = ['languagePicker.chooseLanguage', 'themePicker.chooseThemes', 'themePicker.darkTheme',
    'themePicker.lightTheme', 'themePicker.exportTitle', 'themePicker.exportJson'];
const notificationKeys = ['notifications.title', 'notifications.provider', 'notifications.triggers',
    'notifications.upstreamOffline', 'notifications.upstreamOnline', 'notifications.certExpiring',
    'notifications.updateAvailable', 'notifications.routeOffline', 'notifications.routeOnline',
    'notifications.routeAlertHint', 'notifications.debounce', 'notifications.cooldownMinutes',
    'notifications.cooldownHint', 'notifications.testNotification'];
const notificationProviders = [
    { provider: 'ntfy', title: 'ntfy', keys: ['notifications.ntfyTopicUrl'] },
    { provider: 'discord', title: 'Discord', keys: ['notifications.discordWebhookUrl', 'notifications.discordHint'] },
    { provider: 'slack', title: 'Slack', keys: ['notifications.slackWebhookUrl', 'notifications.slackHint'] },
    { provider: 'pushover', title: 'Pushover', keys: ['notifications.userKey', 'notifications.userKeyPlaceholder',
        'notifications.apiToken', 'notifications.apiTokenPlaceholder', 'notifications.pushoverHint'] },
    { provider: 'custom', title: 'Custom webhook', keys: ['notifications.webhookUrl', 'notifications.httpMethod',
        'notifications.jsonSchema', 'notifications.jsonSchemaHint'] },
];

// Register actual component states, not alternative implementations of the UI.
export const scenarios = [
    ...notificationProviders.map(({ provider, title, keys }) => ({ id: `notifications-${provider}`,
        title: `Notification settings: ${title}`, kind: 'notification-settings', profile: 'notifications-default', provider,
        keys: [...notificationKeys, 'notifications.enable', ...keys] })),
    { id: 'notifications-enabled', title: 'Notification settings: enabled (local only)', kind: 'notification-settings',
        profile: 'notifications-default', provider: 'ntfy', enabled: true,
        keys: [...notificationKeys, 'notifications.disable', 'notifications.ntfyTopicUrl'] },
    { id: 'login', title: 'Sign-in form', kind: 'login', keys: loginKeys },
    { id: 'login-session-expired', title: 'Sign-in: expired session', kind: 'login', sessionExpired: true,
        remountOnTranslation: true, keys: [...loginKeys, 'login.sessionExpired'] },
    { id: 'theme-welcome-dark', title: 'First-run theme selection: dark palette', kind: 'theme-welcome',
        keys: [...welcomeKeys, 'themeWelcome.darkTheme'] },
    { id: 'theme-welcome-light', title: 'First-run theme selection: light palette', kind: 'theme-welcome',
        setup: 'welcome-light', keys: [...welcomeKeys, 'themeWelcome.lightTheme'] },
    { id: 'appearance-controls-dark', title: 'Top-bar controls: dark mode', kind: 'appearance-controls',
        setup: 'theme-menu', mode: 'dark', keys: [...controlKeys, 'themePicker.switchToLight'] },
    { id: 'appearance-controls-light', title: 'Top-bar controls: light mode', kind: 'appearance-controls',
        setup: 'theme-menu', mode: 'light', keys: [...controlKeys, 'themePicker.switchToDark'] },
    { id: 'route-delete', title: 'Route deletion', kind: 'route-confirmation',
        keys: ['routes.deleteConfirm', 'common.delete', 'common.cancel'] },
    { id: 'certificate-delete', title: 'Certificate deletion (interpolation)', kind: 'certificate-confirmation',
        keys: ['tls.deleteConfirm', 'common.delete', 'common.cancel'] },
    { id: 'notification-saved', title: 'Notification settings saved', kind: 'notification-toast', keys: ['notifications.saved'] },
    ...capture.scenarios.filter(profile => Object.hasOwn(titles, profile.id)).map(profile => ({ id: profile.id, title: titles[profile.id], kind: 'dashboard',
        profile: profile.id, keys: dashboardKeys(profile) })),
    { id: 'dashboard-edit-label', title: 'Dashboard: edit server label', kind: 'dashboard', profile: 'dashboard-online',
        setup: 'edit-label', keys: [...dashboardKeys(capture.scenarios[0]), 'dashboard.labelPlaceholder',
            'dashboard.labelHint', 'common.cancel', 'common.save'] },
    { id: 'dashboard-label-saved', title: 'Dashboard: server label saved', kind: 'dashboard', profile: 'dashboard-online',
        setup: 'label-saved', keys: ['dashboard.labelSaved'] },
    { id: 'dashboard-loading', title: 'Dashboard: waiting for status', kind: 'dashboard', profile: 'dashboard-online',
        loading: true, keys: ['common.loading'] },
];

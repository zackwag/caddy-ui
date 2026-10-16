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

const metricsKeys = ['metrics.configuration', 'metrics.caddyMetrics', 'metrics.caddyMetricsHint',
    'metrics.publicEndpoint', 'metrics.publicMetricsHint', 'metrics.totalRequests', 'metrics.sinceProcessStart',
    'metrics.requestsPerSecond', 'metrics.avgOverUptime', 'metrics.avgResponse', 'metrics.meanResponseTime',
    'metrics.statusCodes', 'metrics.responsePercentiles', 'metrics.refreshInterval', 'metrics.lastScraped',
    'common.enabledUpper', 'common.disable', 'common.disabled', 'common.refresh',
    'uptime.routeChecks', 'uptime.routeCheckHint'];
const logKeys = ['logs.caddySource', 'logs.configuration', 'logs.logging', 'logs.format', 'logs.level',
    'logs.logFilePath', 'logs.rollSize', 'logs.rollKeep', 'logs.searchPlaceholder', 'logs.lineCount_other',
    'common.enabledUpper', 'common.disable', 'common.refresh', 'common.export'];

const tlsKeys = ['tls.total', 'tls.managedCerts', 'tls.valid', 'tls.healthy', 'tls.expiring',
    'tls.within14Days', 'tls.expired', 'tls.needsRenewal', 'tls.rootCaCertificate', 'tls.rootCaHint',
    'tls.iosInstruction', 'tls.macosInstruction', 'tls.androidInstruction', 'tls.windowsInstruction',
    'tls.downloadRootCa', 'tls.certificates', 'tls.noCertificates', 'common.refresh'];
const sidebarKeys = ['sidebar.serverManager', 'sidebar.refreshStatus', 'sidebar.signOut',
    'sidebar.backendVersion', 'sidebar.versionDetails', 'sidebar.nav.dashboard', 'sidebar.nav.caddyfile',
    'sidebar.nav.routes', 'sidebar.nav.tls', 'sidebar.nav.logs', 'sidebar.nav.metrics',
    'sidebar.nav.notifications', 'sidebar.nav.instances'];

const routeControls = ['routes.filterPlaceholder', 'routes.onlineSummary', 'routes.columns', 'routes.addRoute', 'common.refresh'];
const routeTable = ['routes.status', 'routes.domain', 'routes.title', 'routes.upstream', 'routes.server',
    'routes.id', 'routes.serverFilterTitle', 'routes.noUpstream', 'routes.enableMaintenance', 'routes.editRoute'];
const historyKeys = ['routeHistory.noDataYet', 'routeHistory.autoRefresh', 'routeHistory.noData',
    'routeHistory.segmentTitle', 'routeHistory.now', 'routeHistory.uptime', 'routeHistory.checks',
    'routeHistory.activity', 'routeHistory.noChanges', 'common.close'];

const caddyfileControls = ['caddyfile.sortEntries', 'caddyfile.history', 'caddyfile.import',
    'caddyfile.reload', 'caddyfile.forceSaveTitle'];
const caddyfileHistory = ['caddyfile.versionHistory', 'caddyfile.showVersionList', 'caddyfile.resizePanes',
    'caddyfile.resizePanesHint', 'caddyfile.paneSizes'];
const caddyfileSnapshot = ['caddyfile.diff', 'caddyfile.raw', 'caddyfile.compareAgainst', 'caddyfile.restore',
    'caddyfile.deleteSnapshot', 'caddyfile.versionPreview'];

const instanceOverview = ['instances.title', 'instances.discover', 'instances.addInstance', 'instances.edit',
    'instances.remove', 'instances.adminUrl', 'instances.container', 'instances.local', 'instances.configPath',
    'instances.newRoutesGoTo', 'instances.logPath', 'instances.dataPath'];
const instanceForm = ['instances.addInstance', 'instances.name', 'instances.namePlaceholder', 'instances.adminUrl',
    'instances.containerName', 'instances.localModePlaceholder', 'instances.localModeHint', 'instances.newRoutesGoTo',
    'instances.serverHint', 'instances.caddyfilePath', 'instances.logPath', 'instances.dataPath', 'instances.add'];
const certificateRows = ['tls.domain', 'tls.issuer', 'tls.expires', 'tls.days', 'tls.status',
    'tls.internal', 'tls.auto'];

// Register actual component states, not alternative implementations of the UI.
export const scenarios = [
    { id: 'instances-local', title: 'Instances: recorded local mode', kind: 'instances',
        profile: 'instances-local', keys: instanceOverview },
    { id: 'instances-add', title: 'Instances: add form', kind: 'instances',
        profile: 'instances-local', setup: 'instance-add', keys: instanceForm },
    { id: 'instances-edit', title: 'Instances: edit local instance', kind: 'instances',
        profile: 'instances-local', setup: 'instance-edit', keys: [...instanceForm.filter(key =>
            !['instances.addInstance', 'instances.add'].includes(key)), 'instances.editInstance'] },
    { id: 'instances-invalid', title: 'Instances: required fields validation', kind: 'instances',
        profile: 'instances-local', setup: 'instance-invalid', remountOnTranslation: true,
        keys: ['instances.nameAndAdminRequired'] },
    { id: 'instances-remove', title: 'Instances: remove confirmation', kind: 'instances',
        profile: 'instances-local', setup: 'instance-remove', remountOnTranslation: true,
        keys: ['instances.removeConfirm'] },
    { id: 'instances-discovery-empty', title: 'Instances: discovery without Docker access', kind: 'instances',
        profile: 'instances-local', setup: 'instance-discover', remountOnTranslation: true,
        keys: ['instances.noNewContainers'] },
    { id: 'instances-empty', title: 'Instances: recorded empty registry without Docker access', kind: 'instances',
        profile: 'instances-empty', keys: ['instances.welcome', 'instances.emptyHint',
            'instances.discoverContainers', 'instances.addManually'] },
    { id: 'instances-missing-server', title: 'Instances: selected HTTP server is missing', kind: 'instances',
        profile: 'instances-missing-server', keys: ['instances.notInCaddyHint', 'instances.notInCaddy'] },
    { id: 'tls-internal-valid', title: 'TLS: certificate issued by the fixture internal CA', kind: 'tls-certificates',
        profile: 'tls-internal-valid', keys: [...certificateRows, 'tls.validUpper'] },
    { id: 'tls-internal-orphaned', title: 'TLS: internal certificate after its host is removed', kind: 'tls-certificates',
        profile: 'tls-internal-orphaned', setup: 'tls-orphaned',
        keys: [...certificateRows, 'tls.orphanedUpper', 'tls.orphanedCount_one'] },
    { id: 'uptime-route-pending', title: 'Uptime: captured named route awaiting checks', kind: 'uptime-populated',
        profile: 'uptime-route-pending', keys: ['uptime.routesOnline', 'uptime.avgUptime', 'uptime.acrossHistory',
            'uptime.lowestUptime', 'uptime.noDataYet', 'uptime.status', 'uptime.route', 'uptime.upstream',
            'uptime.uptime', 'uptime.currentStateFor'] },
    { id: 'caddyfile-editor', title: 'Caddyfile: saved editor', kind: 'caddyfile',
        profile: 'caddyfile-history', keys: caddyfileControls },
    { id: 'caddyfile-empty', title: 'Caddyfile: empty snapshot history', kind: 'caddyfile',
        profile: 'caddyfile-empty', setup: 'caddyfile-history', keys: [...caddyfileHistory, 'caddyfile.noSnapshots'] },
    { id: 'caddyfile-empty-list', title: 'Caddyfile: empty version list', kind: 'caddyfile',
        profile: 'caddyfile-empty', setup: 'caddyfile-list', keys: ['caddyfile.hideVersionList',
            'caddyfile.savedVersions', 'caddyfile.noSavedVersions'] },
    { id: 'caddyfile-diff', title: 'Caddyfile: older snapshot diff', kind: 'caddyfile',
        profile: 'caddyfile-history', setup: 'caddyfile-diff', keys: [...caddyfileSnapshot, 'caddyfile.unchangedLines_other'] },
    { id: 'caddyfile-raw', title: 'Caddyfile: raw snapshot', kind: 'caddyfile',
        profile: 'caddyfile-history', setup: 'caddyfile-raw', keys: ['caddyfile.raw', 'caddyfile.versionPreview'] },
    { id: 'caddyfile-no-differences', title: 'Caddyfile: latest snapshot matches saved file', kind: 'caddyfile',
        profile: 'caddyfile-history', setup: 'caddyfile-history', keys: ['caddyfile.noDifferences'] },
    { id: 'caddyfile-list', title: 'Caddyfile: saved version list', kind: 'caddyfile',
        profile: 'caddyfile-history', setup: 'caddyfile-list', keys: ['caddyfile.latest', 'caddyfile.savedVersions'] },
    { id: 'caddyfile-force-confirm', title: 'Caddyfile: force-save confirmation', kind: 'caddyfile',
        profile: 'caddyfile-history', setup: 'caddyfile-force', remountOnTranslation: true,
        keys: ['caddyfile.forceSaveConfirm', 'caddyfile.forceSave'] },
    { id: 'caddyfile-restore-confirm', title: 'Caddyfile: restore snapshot confirmation', kind: 'caddyfile',
        profile: 'caddyfile-history', setup: 'caddyfile-restore', remountOnTranslation: true, keys: ['caddyfile.restoreConfirm'] },
    { id: 'caddyfile-delete-confirm', title: 'Caddyfile: delete snapshot confirmation', kind: 'caddyfile',
        profile: 'caddyfile-history', setup: 'caddyfile-delete', remountOnTranslation: true, keys: ['caddyfile.deleteSnapshotConfirm'] },
    { id: 'caddyfile-import-confirm', title: 'Caddyfile: import confirmation', kind: 'caddyfile',
        profile: 'caddyfile-history', setup: 'caddyfile-import', remountOnTranslation: true, keys: ['caddyfile.importConfirm'] },
    { id: 'caddyfile-valid', title: 'Caddyfile: successful recorded validation', kind: 'caddyfile',
        profile: 'caddyfile-history', setup: 'caddyfile-valid', remountOnTranslation: true, keys: ['caddyfile.valid'] },
    { id: 'route-edit-unavailable', title: 'Route edit: Caddyfile block unavailable', kind: 'route-edit',
        profile: 'routes-edit-unavailable', setup: 'route-edit', keys: ['routes.titlePlaceholder',
            'routes.titleClearHint', 'routes.caddyfileLoadFailed'] },
    { id: 'routes-overview', title: 'Routes: captured Caddy routes', kind: 'routes',
        profile: 'routes-online', keys: [...routeControls, ...routeTable] },
    { id: 'routes-columns', title: 'Routes: column menu with ID hidden locally', kind: 'routes',
        profile: 'routes-online', setup: 'route-columns', keys: [...routeControls, ...routeTable,
            'routes.domainActionsAlwaysShown', 'routes.someColumnsHidden'] },
    { id: 'routes-add', title: 'Routes: new route form', kind: 'routes', profile: 'routes-online',
        setup: 'route-add', keys: ['routes.newRoute', 'routes.domain', 'routes.upstream',
            'routes.stripPrefixOptional', 'routes.addRoute', 'common.cancel'] },
    { id: 'routes-filtered', title: 'Routes: search with no matching routes', kind: 'routes', profile: 'routes-online',
        path: '/routes?filter=playground-no-matching-routes', keys: [...routeControls, 'routes.clearFilter', 'routes.noMatching'] },
    { id: 'routes-empty', title: 'Routes: captured empty Caddy configuration', kind: 'routes',
        profile: 'routes-empty', keys: [...routeControls, 'routes.noneConfigured'] },
    { id: 'route-history-empty', title: 'Route history: no recorded checks', kind: 'route-history',
        profile: 'route-history-empty', keys: historyKeys },
    { id: 'tls-empty', title: 'TLS: captured empty certificate store', kind: 'tls',
        profile: 'tls-default', keys: tlsKeys },
    ...['valid', 'expiring', 'expired'].map((filter, index) => ({ id: `tls-${filter}`,
        title: `TLS: ${filter} certificate filter`, kind: 'tls', profile: 'tls-default',
        setup: 'tls-filter', filterIndex: index + 1, keys: tlsKeys })),
    ...['online', 'stopped', 'checking'].map(status => ({ id: `sidebar-${status}`,
        title: `Sidebar: ${status === 'checking' ? 'checking connection' : status === 'online' ? 'connected Caddy' : 'unreachable Caddy'}`,
        kind: 'sidebar', profile: `sidebar-${status === 'stopped' ? 'stopped' : 'online'}`,
        loading: status === 'checking', keys: [...sidebarKeys,
            status === 'checking' ? 'sidebar.checking' : status === 'online' ? 'sidebar.connected' : 'sidebar.unreachable'] })),
    { id: 'metrics-overview', title: 'Metrics: enabled with configuration open', kind: 'metrics',
        profile: 'metrics-enabled', setup: 'observability-config',
        keys: [...metricsKeys, 'uptime.upstreamUptime', 'uptime.noRoutesWithUpstreams', 'common.off'] },
    { id: 'metrics-route-checks', title: 'Metrics: local route-check controls', kind: 'metrics',
        profile: 'metrics-enabled', setup: 'observability-config', routeChecks: true,
        keys: [...metricsKeys, 'uptime.routeUptime', 'uptime.noRoutesToCheck', 'common.on'] },
    { id: 'logs-configured', title: 'Access logs: locally enabled configuration and captured lines', kind: 'logs',
        profile: 'logs-default', path: '/logs', setup: 'logs-enabled', keys: logKeys },
    { id: 'logs-filtered', title: 'Access logs: search with no matches', kind: 'logs',
        profile: 'logs-default', path: '/logs?search=playground-no-matching-entries', setup: 'logs-enabled',
        keys: [...logKeys.filter(key => key !== 'logs.lineCount_other'), 'logs.lineCountFiltered',
            'logs.noMatchingLines', 'common.clearSearch'] },
    { id: 'logs-disabled', title: 'Access logs: recorded disabled settings', kind: 'logs',
        profile: 'logs-default', path: '/logs', setup: 'observability-config',
        keys: [...logKeys.filter(key => !['common.enabledUpper', 'common.disable'].includes(key)),
            'common.disabledUpper', 'common.enable'] },
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

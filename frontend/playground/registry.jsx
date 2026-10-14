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

// Register actual component states, not alternative implementations of the UI.
export const scenarios = [
    { id: 'route-delete', title: 'Route deletion', kind: 'route-confirmation',
        keys: ['routes.deleteConfirm', 'common.delete', 'common.cancel'] },
    { id: 'certificate-delete', title: 'Certificate deletion (interpolation)', kind: 'certificate-confirmation',
        keys: ['tls.deleteConfirm', 'common.delete', 'common.cancel'] },
    { id: 'notification-saved', title: 'Notification settings saved', kind: 'notification-toast', keys: ['notifications.saved'] },
    ...capture.scenarios.map(profile => ({ id: profile.id, title: titles[profile.id], kind: 'dashboard',
        profile: profile.id, keys: dashboardKeys(profile) })),
    { id: 'dashboard-edit-label', title: 'Dashboard: edit server label', kind: 'dashboard', profile: 'dashboard-online',
        setup: 'edit-label', keys: [...dashboardKeys(capture.scenarios[0]), 'dashboard.labelPlaceholder',
            'dashboard.labelHint', 'common.cancel', 'common.save'] },
    { id: 'dashboard-label-saved', title: 'Dashboard: server label saved', kind: 'dashboard', profile: 'dashboard-online',
        setup: 'label-saved', keys: ['dashboard.labelSaved'] },
    { id: 'dashboard-loading', title: 'Dashboard: waiting for status', kind: 'dashboard', profile: 'dashboard-online',
        loading: true, keys: ['common.loading'] },
];

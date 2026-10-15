import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const JSON_H = { 'content-type': 'application/json; charset=utf-8' };
const TEXT_H = { 'content-type': 'text/plain; charset=utf-8' };
const r = (method, path, body, status, headers, responseBody) => ({
    request: { method, path, body }, response: { status, headers: headers || JSON_H, body: responseBody }
});
const get = (path, body) => r('GET', path, null, 200, JSON_H, body);
const getText = (path, text) => r('GET', path, null, 200, TEXT_H, text);

const instances = [
    { id: 'default', name: 'Production', adminUrl: 'http://caddy-screenshots:2019', configPath: '/etc/caddy/Caddyfile',
      logPath: '/var/log/caddy/access.log', dataPath: '/var/lib/caddy', containerName: 'caddy-production', serverName: 'srv0' },
    { id: '00000000-0000-4000-8000-000000000001', name: 'Staging Server', adminUrl: 'http://192.168.1.50:2019',
      configPath: '/etc/caddy/Caddyfile', logPath: '/var/log/caddy/access.log', dataPath: '/var/lib/caddy', containerName: '', serverName: 'srv0' },
];

const status = { online: true, serverCount: 1, routeCount: 3, upstreamsOnline: 2, upstreamsTotal: 2, uptime: '3d 14h',
    servers: [{ name: 'srv0', listen: [':443', ':80'], routeCount: 3 }], tlsEnabled: true, adminUrl: 'http://caddy-screenshots:2019' };

const process_ = { ok: true, version: 'v2.10.2', uptime: '3d 14h', uptimeSeconds: 309600,
    memAlloc: 12.4, memSys: 24.8, lastReload: '2025-01-01T12:00:00.000Z', lastReloadSuccess: true };

const caddyfileContent = `{
    admin 0.0.0.0:2019
    auto_https off
}

example.com {
    reverse_proxy 192.168.1.10:8080
}

media.home.arpa {
    reverse_proxy 192.168.1.20:8096
}

api.internal {
    reverse_proxy 192.168.1.30:3000
}
`;

const routes = [
    { '@id': 'route-1', group: '', match: [{ host: ['example.com'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '192.168.1.10:8080' }] }], terminal: true, _server: 'srv0', _simpleProxy: true },
    { '@id': 'route-2', group: '', match: [{ host: ['media.home.arpa'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '192.168.1.20:8096' }] }], terminal: true, _server: 'srv0', _simpleProxy: true },
    { '@id': 'route-3', group: '', match: [{ host: ['api.internal'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '192.168.1.30:3000' }] }], terminal: true, _server: 'srv0', _simpleProxy: true },
];

const now = Date.parse('2025-01-01T12:00:00Z') / 1000;
const day = 86400;

const certs = [
    { domain: 'example.com', issuer: 'acme', issuerDir: 'acme-v02.api.letsencrypt.org-directory',
      validFrom: new Date((now - 60 * day) * 1000).toISOString(), validTo: new Date((now + 30 * day) * 1000).toISOString(),
      daysRemaining: 30, isManaged: true, isInternal: false, status: 'valid' },
    { domain: 'www.example.com', issuer: 'acme', issuerDir: 'acme-v02.api.letsencrypt.org-directory',
      validFrom: new Date((now - 60 * day) * 1000).toISOString(), validTo: new Date((now + 30 * day) * 1000).toISOString(),
      daysRemaining: 30, isManaged: true, isInternal: false, status: 'valid' },
    { domain: 'media.home.arpa', issuer: 'acme', issuerDir: 'acme-v02.api.letsencrypt.org-directory',
      validFrom: new Date((now - 80 * day) * 1000).toISOString(), validTo: new Date((now + 10 * day) * 1000).toISOString(),
      daysRemaining: 10, isManaged: true, isInternal: false, status: 'expiring' },
    { domain: 'api.internal', issuer: 'internal', issuerDir: 'local',
      validFrom: new Date((now - 350 * day) * 1000).toISOString(), validTo: new Date((now + 365 * day) * 1000).toISOString(),
      daysRemaining: 365, isManaged: true, isInternal: true, status: 'valid' },
    { domain: 'old.example.com', issuer: 'acme', issuerDir: 'acme-v02.api.letsencrypt.org-directory',
      validFrom: new Date((now - 400 * day) * 1000).toISOString(), validTo: new Date((now - 35 * day) * 1000).toISOString(),
      daysRemaining: -35, isManaged: true, isInternal: false, status: 'expired' },
];

const logLines = [];
const methods = ['GET', 'POST', 'GET', 'GET', 'PUT', 'GET', 'GET', 'GET'];
const hosts = ['example.com', 'example.com', 'media.home.arpa', 'api.internal', 'api.internal', 'example.com', 'media.home.arpa', 'example.com'];
const uris = ['/', '/login', '/movies', '/v1/status', '/v1/config', '/assets/main.js', '/stream/1', '/api/health'];
const statuses = [200, 302, 200, 200, 204, 200, 200, 200];
const sizes = [4523, 0, 18742, 256, 0, 89012, 0, 128];
const durations = [0.012, 0.045, 0.089, 0.003, 0.021, 0.008, 1.234, 0.002];
for (let i = 0; i < 8; i++) {
    const entry = { level: 'info', ts: now - (8 - i) * 30, logger: 'http.log.access', msg: 'handled request',
        request: { remote_ip: `192.168.1.${100 + i}`, remote_port: 40000 + i, proto: 'HTTP/2.0',
            method: methods[i], host: hosts[i], uri: uris[i], headers: { 'User-Agent': ['Mozilla/5.0'] } },
        duration: durations[i], size: sizes[i], status: statuses[i], resp_headers: { 'Content-Type': ['text/html'] } };
    logLines.push(JSON.stringify(entry));
}

const uptimeStats = {
    '192.168.1.10:8080': { pct: 100, total: 48, online: 48, currentlyOnline: true, streak: 48, streakSeconds: 86400, streakLabel: '1d 0h', firstSeen: new Date((now - 2 * day) * 1000).toISOString(), lastCheckAt: new Date(now * 1000).toISOString() },
    '192.168.1.20:8096': { pct: 95.8, total: 48, online: 46, currentlyOnline: true, streak: 20, streakSeconds: 36000, streakLabel: '10h 0m', firstSeen: new Date((now - 2 * day) * 1000).toISOString(), lastCheckAt: new Date(now * 1000).toISOString() },
    '192.168.1.30:3000': { pct: 100, total: 48, online: 48, currentlyOnline: true, streak: 48, streakSeconds: 86400, streakLabel: '1d 0h', firstSeen: new Date((now - 2 * day) * 1000).toISOString(), lastCheckAt: new Date(now * 1000).toISOString() },
};

const routeUptimeStats = {
    'example.com': { pct: 100, total: 48, online: 48, currentlyOnline: true, streak: 48, streakSeconds: 86400, streakLabel: '1d 0h', firstSeen: new Date((now - 2 * day) * 1000).toISOString(), lastCheckAt: new Date(now * 1000).toISOString() },
    'media.home.arpa': { pct: 97.2, total: 48, online: 46, currentlyOnline: true, streak: 30, streakSeconds: 54000, streakLabel: '15h 0m', firstSeen: new Date((now - 2 * day) * 1000).toISOString(), lastCheckAt: new Date(now * 1000).toISOString() },
    'api.internal': { pct: 100, total: 48, online: 48, currentlyOnline: true, streak: 48, streakSeconds: 86400, streakLabel: '1d 0h', firstSeen: new Date((now - 2 * day) * 1000).toISOString(), lastCheckAt: new Date(now * 1000).toISOString() },
};

const healthChecks = [
    { domain: 'example.com', upstream: '192.168.1.10:8080', server: 'srv0', online: true, checkedAt: '2025-01-01T11:59:30.000Z' },
    { domain: 'media.home.arpa', upstream: '192.168.1.20:8096', server: 'srv0', online: true, checkedAt: '2025-01-01T11:59:30.000Z' },
    { domain: 'api.internal', upstream: '192.168.1.30:3000', server: 'srv0', online: true, checkedAt: '2025-01-01T11:59:30.000Z' },
];

const requests = [
    get('/auth/status', { authEnabled: false, publicMetrics: false }),
    get('/auth/check', { authEnabled: false }),
    get('/languages', { enabled: ['en'], available: ['en', 'de', 'ar'] }),
    get('/settings', { darkTheme: 'vt2026', lightTheme: 'coarse-everywhere',
        routeColumns: { status: true, server: true, id: false, upstream: true, title: true }, routeChecks: true,
        metricsConfig: { enabled: true } }),
    get('/custom-themes', []),
    get('/version?frontend=dev', { version: '1.20.0', frontend: null, backend: null }),
    get('/instances', instances),
    get('/instances/status', [
        { id: 'default', online: true },
        { id: '00000000-0000-4000-8000-000000000001', online: false },
    ]),
    get('/status', status),
    get('/status/process', process_),
    get('/server-names', { srv0: 'Production HTTPS' }),
    get('/health', healthChecks),
    getText('/caddyfile', caddyfileContent),
    get('/caddyfile/history', [
        { timestamp: '2025-01-01T10:00:00.000Z', filename: 'Caddyfile-2025-01-01T10-00-00', size: caddyfileContent.length },
        { timestamp: '2025-01-01T08:00:00.000Z', filename: 'Caddyfile-2025-01-01T08-00-00', size: caddyfileContent.length - 20 },
    ]),
    get('/routes', routes),
    get('/tls', certs),
    get('/route-notes', { 'example.com': 'Main website', 'media.home.arpa': 'Jellyfin media server' }),
    get('/routes/maintenance', {}),
    get('/health/uptime', uptimeStats),
    get('/health/uptime?kind=route', routeUptimeStats),
    get('/logs', { lines: logLines, path: '/var/log/caddy/access.log' }),
    get('/logs/config', { enabled: true, path: '/var/log/caddy/access.log', format: 'json', level: 'INFO', rollSize: '50mb', rollKeep: 5 }),
    get('/metrics', { ok: true, totalRequests: 142857, statusGroups: { '2xx': 138420, '3xx': 2100, '4xx': 1890, '5xx': 447 },
        avgResponseMs: 12.7, p50: 5.2, p95: 32.1, p99: 89.5, rps: 23.4, uptimeSeconds: 309600,
        scrapedAt: '2025-01-01T12:00:00.000Z' }),
    get('/metrics/config', { enabled: true }),
    get('/notifications/config', { enabled: true, provider: 'ntfy',
        ntfy: { url: 'https://ntfy.example.com/caddy-alerts' },
        triggers: { upstreamOffline: true, upstreamOnline: true, certExpiring: true, updateAvailable: true, routeOffline: false, routeOnline: false },
        debounceMinutes: 30 }),
    get('/server-names/all', { default: { srv0: 'Production HTTPS' }, '00000000-0000-4000-8000-000000000001': {} }),
    get('/instances/servers?adminUrl=http%3A%2F%2Fcaddy-screenshots%3A2019', ['srv0']),
    get('/instances/servers?adminUrl=http%3A%2F%2F192.168.1.50%3A2019', ['srv0']),
];

const capture = {
    formatVersion: 1,
    source: { commit: 'a'.repeat(40), caddyImage: 'caddy:2.10.2-alpine' },
    normalization: ['Hand-crafted fixture data for screenshot generation'],
    scenarios: [{ id: 'screenshots', requests }],
};

const output = resolve(import.meta.dirname, 'captures/screenshots.json');
await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
console.log(`Wrote ${requests.length} request/response pairs to ${output}`);

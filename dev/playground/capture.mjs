import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { caddyGet, caddyPost } from '../../src/backend/src/caddy.js';
import { captureFromCommandLine, hideInstance, runCapture } from './capture-session.mjs';

const paths = ['/status', '/status/process', '/server-names'];

export function captureDashboard({ output = resolve(import.meta.dirname, 'captures/dashboard.json'), ...options } = {}) {
    return runCapture({ name: 'preview', output, ...options }, async ({ harness, directory, signal, until, environment, startBackend }, commit) => {
        // Requests go to whichever backend `client` is.
        let client;
        const api = (...args) => client.api(...args);
        const successful = (...args) => client.successful(...args);
        async function snapshot(id) {
            const requests = [];
            for (const path of paths) {
                requests.push(await api(path));
            }
            return { id, requests };
        }
        const info = await harness.create('preview');
        const env = environment(info.instance, { APP_VERSION: 'dev-caddy-preview' });
        const main = await startBackend(env);
        client = main;
        const csrfRecord = await successful('/auth/csrf');
        // Replay needs the observed response shape, never a live context secret.
        csrfRecord.response.body.csrfToken = 'offline-preview-context';
        const caddyfileEmpty = { id: 'caddyfile-empty', requests: [await successful('/caddyfile'), await successful('/caddyfile/history')] };
        assert.deepEqual(caddyfileEmpty.requests[1].response.body, []);
        await successful('/metrics/config', 'PUT', { enabled: true });
        const label = await successful('/server-names/srv0', 'PUT', { name: 'Playground HTTP' });
        const online = await snapshot('dashboard-online');
        assert(online.requests.every(record => record.response.status === 200));
        assert.equal(online.requests[0].response.body.online, true);
        assert(online.requests[0].response.body.servers.length > 0);
        assert.equal(online.requests[1].response.body.ok, true);
        online.requests.push(label);
        // Use the same private instance for observability previews. Seed real
        // access logs and metrics without any remote upstream or provider.
        for (const [path, status] of [['/health', 200], ['/error', 503]]) {
            const response = await fetch(info.httpUrl + path, { headers: { Host: 'caddy-preview.localhost' },
                signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
            assert.equal(response.status, status);
            await response.text();
        }
        const metrics = { id: 'metrics-enabled', requests: [] };
        for (const path of ['/metrics', '/metrics/config', '/auth/status', '/routes', '/health/uptime',
            '/health/uptime?kind=route', '/route-notes']) {
            metrics.requests.push(await successful(path));
        }
        assert.equal(metrics.requests[0].response.body.ok, true);
        const logs = { id: 'logs-default', requests: [await successful('/logs'), await successful('/logs/config')] };
        assert(logs.requests[0].response.body.lines.length >= 2, 'Seeded access logs were not captured');
        assert.equal(logs.requests[1].response.body.enabled, false);
        const logAddresses = [...new Set(logs.requests[0].response.body.lines.map(line => JSON.parse(line).request?.remote_ip).filter(Boolean))];
        // Capture the actual empty store and sidebar reads from this private instance.
        const tls = { id: 'tls-default', requests: [await successful('/tls')] };
        assert.deepEqual(tls.requests[0].response.body, []);
        const sidebarPaths = ['/version?frontend=dev', '/instances', '/instances/status', '/status'];
        async function sidebarSnapshot(id) {
            const requests = [];
            for (const path of sidebarPaths) {
                requests.push(await successful(path));
            }
            return { id, requests };
        }
        const routePaths = ['/routes', '/tls', '/route-notes', '/server-names', '/routes/maintenance', '/health', '/health/uptime'];
        async function routeSnapshot(id) {
            const requests = [];
            for (const path of routePaths) {
                requests.push(await successful(path));
            }
            return { id, requests };
        }
        const routesOnline = await routeSnapshot('routes-online');
        assert(routesOnline.requests[0].response.body.length > 0);
        const history = { id: 'route-history-empty', clock: Date.now(), requests: [] };
        for (const hours of [1, 6, 24, 168]) {
            const record = await successful(`/health/history?route=preview.home.arpa&since=${history.clock - hours * 60 * 60 * 1000}`);
            assert.deepEqual(record.response.body.entries, []);
            history.requests.push(record);
        }
        const sidebarOnline = await sidebarSnapshot('sidebar-online');
        // Read untouched notification defaults without configuring or sending.
        const notifications = { id: 'notifications-default', requests: [await successful('/notifications/config')] };
        assert.equal(notifications.requests[0].response.body.enabled, false);
        assert.equal(notifications.requests[0].response.body.provider, 'ntfy');
        // Seed snapshots through real saves in this capture's disposable instance.
        // Only harmless comments change; no external sites or upstreams are added.
        const before = (await successful('/caddyfile')).response.body;
        const revised = before + '\n# Localization playground snapshot\n';
        await successful('/caddyfile?fmt=false&sort=false', 'PUT', revised);
        // One save retains the previous baseline and commits the saved version.
        const caddyfileHistory = { id: 'caddyfile-history', requests: [await successful('/caddyfile'), await successful('/caddyfile/history')] };
        const entries = caddyfileHistory.requests[1].response.body;
        assert(entries.length >= 2);
        for (const entry of entries) {
            caddyfileHistory.requests.push(await successful(`/caddyfile/history/${entry.filename}`));
        }
        caddyfileHistory.requests.push(await successful('/caddyfile/validations?fmt=true', 'POST', revised));
        const original = await caddyGet('/config/', info.instance.adminUrl);
        const loadConfig = config => caddyPost('/load', config, info.instance.adminUrl);
        // Issue one real certificate with Caddy's internal CA. Never use ACME
        // or contact an external hostname; this listener stays inside the fixture.
        const certified = structuredClone(original);
        certified.apps.tls = { automation: { policies: [{ subjects: ['preview.internal'], issuers: [{ module: 'internal' }] }] } };
        certified.apps.http.servers.preview_tls = { listen: [':8443'], automatic_https: { disable_redirects: true },
            tls_connection_policies: [{}], routes: [{ match: [{ host: ['preview.internal'] }],
                handle: [{ handler: 'static_response', body: 'Internal certificate preview' }] }] };
        await loadConfig(certified);
        const certRecord = await until(() => successful('/tls'), certRecord => certRecord.response.body.some(cert => cert.domain === 'preview.internal' && cert.status === 'valid'), 'certRecord');
        assert.equal(certRecord.response.body.length, 1);
        assert.equal(certRecord.response.body[0].status, 'valid');
        const tlsValid = { id: 'tls-internal-valid', requests: [certRecord] };
        // Served by Caddy, but with no block in the Caddyfile to edit
        const routeEdit = await routeSnapshot('routes-edit-unavailable');
        routeEdit.requests.push(await api('/routes/caddyfile/preview.internal'));
        assert.equal(routeEdit.requests.at(-1).response.status, 404);
        const uptimePending = { id: 'uptime-route-pending', requests: [] };
        for (const path of ['/routes', '/health/uptime', '/health/uptime?kind=route', '/route-notes']) {
            uptimePending.requests.push(await successful(path));
        }
        const orphaned = structuredClone(original);
        orphaned.apps.tls = { automation: { policies: [] } };
        await loadConfig(orphaned);
        const orphanRecord = await until(() => successful('/tls'), orphanRecord => orphanRecord.response.body.some(cert => cert.domain === 'preview.internal' && cert.status === 'orphaned'), 'orphanRecord');
        const tlsOrphaned = { id: 'tls-internal-orphaned', requests: [orphanRecord] };
        assert.equal(tlsOrphaned.requests[0].response.body[0].status, 'orphaned');

        // A separate real local-mode backend has no Docker socket. Discovery
        // returns the production unavailable-Docker fallback without inspecting
        // unrelated containers on the capture host.
        const localDirectory = resolve(directory, 'local-instance');
        await mkdir(resolve(localDirectory, 'backend'), { recursive: true });
        const localConfig = resolve(localDirectory, 'Caddyfile');
        await writeFile(localConfig, revised);
        const local = await startBackend(environment({ ...info.instance, adminUrl: '', containerName: '' },
            { APP_VERSION: env.APP_VERSION, DOCKER_SOCKET: resolve(localDirectory, 'docker-unavailable.sock') }, localDirectory));
        client = local;
        const added = await successful('/instances', 'POST', { name: 'Local Preview', adminUrl: info.instance.adminUrl,
            containerName: '', serverName: 'srv0', configPath: localConfig,
            logPath: resolve(localDirectory, 'access.log'), dataPath: resolve(localDirectory, 'data') });
        const localId = added.response.body.id;
        const serversPath = `/instances/servers?adminUrl=${encodeURIComponent(info.instance.adminUrl)}`;
        async function instanceSnapshot(id, empty = false) {
            const requests = [];
            for (const path of ['/instances', '/instances/status', '/instances/discover', '/server-names/all', ...(empty ? [] : [serversPath])]) {
                requests.push(await api(path));
            }
            assert.deepEqual(requests[2].response.body, []);
            return { id, requests };
        }
        const instancesLocal = await instanceSnapshot('instances-local');
        assert.equal(instancesLocal.requests[0].response.body[0].containerName, '');
        client = main;
        const empty = structuredClone(original);
        empty.apps.http.servers = {};
        await loadConfig(empty);
        const noServers = await until(() => snapshot('dashboard-empty'), noServers => noServers.requests[0].response.body.serverCount === 0, 'noServers');
        assert.equal(noServers.requests[0].response.body.online, true, JSON.stringify(noServers.requests[0].response.body));
        assert.equal(noServers.requests[0].response.body.serverCount, 0);
        const routesEmpty = await routeSnapshot('routes-empty');
        assert.deepEqual(routesEmpty.requests[0].response.body, []);
        client = local;
        const instancesMissing = await instanceSnapshot('instances-missing-server');
        assert.deepEqual(instancesMissing.requests.at(-1).response.body, []);
        await successful(`/instances/${localId}`, 'DELETE');
        const instancesEmpty = await instanceSnapshot('instances-empty', true);
        assert.deepEqual(instancesEmpty.requests[0].response.body, []);
        client = main;
        await harness.stop('preview');
        const stopped = await until(() => snapshot('dashboard-stopped'), stopped => stopped.requests[0].response.body.online === false, 'stopped');
        assert.equal(stopped.requests[0].response.body.online, false);
        assert.equal(stopped.requests[0].response.body.code, 'CADDY_STATUS_UNAVAILABLE');
        const sidebarStopped = await until(() => sidebarSnapshot('sidebar-stopped'), sidebarStopped => sidebarStopped.requests[3].response.body.online === false, 'sidebarStopped');
        assert.equal(sidebarOnline.requests[3].response.body.online, true);
        assert.equal(sidebarStopped.requests[3].response.body.online, false);
        return {
            csrfContext: { source: { commit }, record: csrfRecord },
            scenarios: [online, noServers, stopped, notifications, metrics, logs, tls, sidebarOnline, sidebarStopped, routesOnline, routesEmpty, history, caddyfileEmpty, caddyfileHistory, routeEdit, tlsValid, tlsOrphaned, uptimePending, instancesLocal, instancesMissing, instancesEmpty],
            replacements: [...hideInstance(info, 'caddy-preview'), ...logAddresses.map((address, index) => [address, `192.0.2.${index + 10}`])],
        };
    });
}

await captureFromCommandLine(import.meta.url, captureDashboard, capture => `Captured ${capture.scenarios.length} real localization profiles`);

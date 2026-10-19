import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { backendEnvironment, checkDocker, Harness, IMAGE } from '../dev-caddy/harness.mjs';
import { CAPTURE_VERSION, normalizeCapture, validateCapture } from './capture-format.js';
import { sourceFingerprint } from './capture-source.mjs';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const paths = ['/status', '/status/process', '/server-names', '/health'];

export async function captureDashboard({ output = resolve(import.meta.dirname, 'captures/dashboard.json'), backendEntry = resolve(root, 'src/backend/src/index.js'), onNamespace = () => {}, onBackend = () => {} } = {}) {
    if (process.platform === 'win32') throw new Error('Capture requires a Unix socket. Run it in Linux CI, WSL, or a Dev Container; replay works without Docker.');
    await checkDocker();
    const context = process.env.DOCKER_CONTEXT;
    const endpoint = !context && process.env.DOCKER_HOST ? process.env.DOCKER_HOST
        : (await exec('docker', ['context', 'inspect', ...(context ? [context] : []), '--format', '{{.Endpoints.docker.Host}}'])).stdout.trim();
    if (!endpoint.startsWith('unix://')) throw new Error('Capture needs a Unix Docker socket accessible to both the CLI and backend. Use Docker-outside-of-Docker in a Dev Container, WSL, or Linux CI.');
    const directory = await mkdtemp(resolve(tmpdir(), 'caddy-ui-preview-'));
    const harness = new Harness(randomBytes(8).toString('hex'));
    const backends = [];
    let outputLog = '';
    let result;
    let failure;
    const socketPath = resolve(directory, 'backend.sock');
    let activeSocket = socketPath;
    const startup = new AbortController();
    const interrupt = () => startup.abort(new Error('Capture interrupted.'));
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    const requestContexts = new Map();
    async function api(path, method = 'GET', body = null) {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !requestContexts.get(activeSocket)?.['X-CSRF-Token']) {
            await api('/auth/csrf');
        }
        return new Promise((resolve, reject) => {
            const call = request({ socketPath: activeSocket, path: '/api' + path, method, timeout: 5000, signal: startup.signal,
                headers: { ...requestContexts.get(activeSocket), 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json', 'X-Instance-Id': 'default' } }, response => {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('error', reject);
                response.on('end', () => {
                    try {
                        const text = Buffer.concat(chunks).toString();
                        const headers = Object.fromEntries(['content-type', 'x-request-id'].filter(key => response.headers[key]).map(key => [key, response.headers[key]]));
                        const cookie = response.headers['set-cookie']?.at(-1);
                        if (cookie) requestContexts.set(activeSocket, { Cookie: cookie.split(';')[0] });
                        if (path === '/auth/csrf') requestContexts.set(activeSocket, {
                            ...requestContexts.get(activeSocket), 'X-CSRF-Token': JSON.parse(text).csrfToken,
                        });
                        resolve({ request: { method, path, body }, response: {
                            status: response.statusCode, headers,
                            body: headers['content-type']?.includes('application/json') ? JSON.parse(text) : text,
                        } });
                    } catch (error) { reject(error); }
                });
            });
            call.on('timeout', () => call.destroy(new Error(`Capture request timed out: ${method} ${path}`)));
            call.on('error', reject);
            if (body !== null) call.write(typeof body === 'string' ? body : JSON.stringify(body));
            call.end();
        });
    }
    async function successful(path, method, body) {
        const record = await api(path, method, body);
        assert(record.response.status >= 200 && record.response.status < 300, `${method || 'GET'} ${path}: ${JSON.stringify(record.response.body)}`);
        return record;
    }
    async function snapshot(id) {
        const requests = [];
        for (const path of paths) requests.push(await api(path));
        return { id, requests };
    }
    function startBackend(env) {
        const backend = spawn(process.execPath, [backendEntry], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
        backends.push(backend);
        for (const stream of [backend.stdout, backend.stderr]) stream.on('data', data => { outputLog = (outputLog + data).slice(-64000); });
        backend.on('error', error => startup.abort(error));
        backend.once('close', (code, signal) => startup.abort(new Error(`Capture backend exited (${code ?? signal}).\n${outputLog}`)));
        onBackend(backend.pid);
    }
    async function waitForBackend() {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            startup.signal.throwIfAborted();
            try {
                const version = await api('/version');
                if (version.response.body.version === 'dev-caddy-preview') return;
            } catch { startup.signal.throwIfAborted(); }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`Capture backend did not become ready.\n${outputLog}`);
    }
    try {
        onNamespace(harness.project);
        assert.deepEqual(await harness.names(), []);
        assert.deepEqual(await harness.names('volume'), []);
        const info = await harness.create('preview');
        const env = { ...backendEnvironment(directory, info.instance), PORT: socketPath,
            DOCKER_SOCKET: fileURLToPath(endpoint.replace(/^unix:/, 'file:')),
            APP_VERSION: 'dev-caddy-preview', CADDY_UI_PUBLIC_METRICS: 'false', CADDY_UI_ADDITIONAL_LANGUAGES: '',
            CADDY_SERVER_NAME: 'srv0', NODE_ENV: 'development' };
        for (const key of ['CADDY_UI_USER', 'CADDY_UI_PASSWORD', 'JWT_SECRET']) delete env[key];
        await mkdir(resolve(directory, 'backend'), { recursive: true });
        startBackend(env);
        await waitForBackend();
        await successful('/auth/setup', 'POST', { username: 'capture-administrator', password: randomBytes(24).toString('base64url') });
        const csrfRecord = await successful('/auth/csrf');
        // Replay needs the observed response shape, never a live context secret.
        csrfRecord.response.body.csrfToken = 'offline-preview-context';
        const caddyfileEmpty = { id: 'caddyfile-empty', requests: [await successful('/caddyfile'), await successful('/caddyfile/history')] };
        assert.deepEqual(caddyfileEmpty.requests[1].response.body, []);
        await successful('/metrics/config', 'PUT', { enabled: true });
        const label = await successful('/server-names/srv0', 'PUT', { name: 'Playground HTTP' });
        const online = await snapshot('dashboard-online');
        assert(online.requests.every(record => record.response.status === 200));
        assert(Array.isArray(online.requests[3].response.body));
        assert.equal(online.requests[0].response.body.online, true);
        assert(online.requests[0].response.body.servers.length > 0);
        assert.equal(online.requests[1].response.body.ok, true);
        online.requests.push(label);
        // Use the same private instance for observability previews. Seed real
        // access logs and metrics without any remote upstream or provider.
        for (const [path, status] of [['/health', 200], ['/error', 503]]) {
            const response = await fetch(info.httpUrl + path, { headers: { Host: 'caddy-preview.localhost' },
                signal: AbortSignal.any([startup.signal, AbortSignal.timeout(5000)]) });
            assert.equal(response.status, status);
            await response.text();
        }
        const metrics = { id: 'metrics-enabled', requests: [] };
        for (const path of ['/metrics', '/metrics/config', '/auth/status', '/routes', '/health/uptime',
            '/health/uptime?kind=route', '/route-notes']) metrics.requests.push(await successful(path));
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
            for (const path of sidebarPaths) requests.push(await successful(path));
            return { id, requests };
        }
        const routePaths = ['/routes', '/tls', '/route-notes', '/server-names', '/routes/maintenance', '/health', '/health/uptime'];
        async function routeSnapshot(id) {
            const requests = [];
            for (const path of routePaths) requests.push(await successful(path));
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
        const routeEdit = { id: 'routes-edit-unavailable', requests: [...routesOnline.requests,
            await api(`/routes/caddyfile/${encodeURIComponent('—')}`)] };
        assert(routeEdit.requests.at(-1).response.status >= 400);
        // Seed snapshots through real saves in this capture's disposable instance.
        // Only harmless comments change; no external sites or upstreams are added.
        const before = (await successful('/caddyfile')).response.body;
        const revised = before + '\n# Localization playground snapshot\n';
        await successful('/caddyfile?fmt=false&sort=false', 'PUT', revised);
        // Snapshot filenames have second precision. Keep the two saves distinct.
        await new Promise(resolve => setTimeout(resolve, 1010 - Date.now() % 1000));
        await successful('/caddyfile?fmt=false&sort=false', 'PUT', revised);
        const caddyfileHistory = { id: 'caddyfile-history', requests: [await successful('/caddyfile'), await successful('/caddyfile/history')] };
        const entries = caddyfileHistory.requests[1].response.body;
        assert(entries.length >= 2);
        for (const entry of entries) caddyfileHistory.requests.push(await successful(`/caddyfile/history/${entry.filename}`));
        caddyfileHistory.requests.push(await successful('/caddyfile/validations?fmt=true', 'POST', revised));
        const adminHeaders = { 'Content-Type': 'application/json', Origin: 'http://0.0.0.0:2019' };
        const original = await (await fetch(info.instance.adminUrl + '/config/', { headers: adminHeaders, signal: AbortSignal.any([startup.signal, AbortSignal.timeout(5000)]) })).json();
        async function loadConfig(config) {
            const response = await fetch(info.instance.adminUrl + '/load', { method: 'POST', headers: adminHeaders,
                body: JSON.stringify(config), signal: AbortSignal.any([startup.signal, AbortSignal.timeout(5000)]) });
            assert.equal(response.ok, true, await response.text());
        }
        // Issue one real certificate with Caddy's internal CA. Never use ACME
        // or contact an external hostname; this listener stays inside the fixture.
        const certified = structuredClone(original);
        certified.apps.tls = { automation: { policies: [{ subjects: ['preview.internal'], issuers: [{ module: 'internal' }] }] } };
        certified.apps.http.servers.preview_tls = { listen: [':8443'], automatic_https: { disable_redirects: true },
            tls_connection_policies: [{}], routes: [{ match: [{ host: ['preview.internal'] }],
                handle: [{ handler: 'static_response', body: 'Internal certificate preview' }] }] };
        await loadConfig(certified);
        let certRecord;
        const certDeadline = Date.now() + 15000;
        while (Date.now() < certDeadline) {
            certRecord = await successful('/tls');
            if (certRecord.response.body.some(cert => cert.domain === 'preview.internal' && cert.status === 'valid')) break;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        assert.equal(certRecord.response.body.length, 1);
        assert.equal(certRecord.response.body[0].status, 'valid');
        const tlsValid = { id: 'tls-internal-valid', requests: [certRecord] };
        const uptimePending = { id: 'uptime-route-pending', requests: [] };
        for (const path of ['/routes', '/health/uptime', '/health/uptime?kind=route', '/route-notes']) {
            uptimePending.requests.push(await successful(path));
        }
        const orphaned = structuredClone(original);
        orphaned.apps.tls = { automation: { policies: [] } };
        await loadConfig(orphaned);
        let orphanRecord;
        const orphanDeadline = Date.now() + 15000;
        while (Date.now() < orphanDeadline) {
            orphanRecord = await successful('/tls');
            if (orphanRecord.response.body.some(cert => cert.domain === 'preview.internal' && cert.status === 'orphaned')) break;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        const tlsOrphaned = { id: 'tls-internal-orphaned', requests: [orphanRecord] };
        assert.equal(tlsOrphaned.requests[0].response.body[0].status, 'orphaned');

        // A separate real local-mode backend has no Docker socket. Discovery
        // returns the production unavailable-Docker fallback without inspecting
        // unrelated containers on the capture host.
        const localDirectory = resolve(directory, 'local-instance');
        await mkdir(resolve(localDirectory, 'backend'), { recursive: true });
        const localConfig = resolve(localDirectory, 'Caddyfile');
        await writeFile(localConfig, revised);
        const localEnv = { ...env, ...backendEnvironment(localDirectory, { ...info.instance, adminUrl: '', containerName: '' }),
            PORT: resolve(localDirectory, 'backend.sock'), APP_VERSION: env.APP_VERSION,
            DOCKER_SOCKET: resolve(localDirectory, 'docker-unavailable.sock') };
        for (const key of ['CADDY_UI_USER', 'CADDY_UI_PASSWORD', 'JWT_SECRET']) delete localEnv[key];
        activeSocket = localEnv.PORT;
        startBackend(localEnv);
        await waitForBackend();
        await successful('/auth/setup', 'POST', { username: 'capture-administrator', password: randomBytes(24).toString('base64url') });
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
        activeSocket = socketPath;
        const empty = structuredClone(original);
        empty.apps.http.servers = {};
        const reload = await fetch(info.instance.adminUrl + '/load', { method: 'POST', headers: adminHeaders, body: JSON.stringify(empty), signal: AbortSignal.any([startup.signal, AbortSignal.timeout(5000)]) });
        assert.equal(reload.ok, true, await reload.text());
        let noServers;
        const emptyDeadline = Date.now() + 15000;
        while (Date.now() < emptyDeadline) {
            noServers = await snapshot('dashboard-empty');
            if (noServers.requests[0].response.body.serverCount === 0) break;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        assert.equal(noServers.requests[0].response.body.online, true, JSON.stringify(noServers.requests[0].response.body));
        assert.equal(noServers.requests[0].response.body.serverCount, 0);
        const routesEmpty = await routeSnapshot('routes-empty');
        assert.deepEqual(routesEmpty.requests[0].response.body, []);
        activeSocket = localEnv.PORT;
        const instancesMissing = await instanceSnapshot('instances-missing-server');
        assert.deepEqual(instancesMissing.requests.at(-1).response.body, []);
        await successful(`/instances/${localId}`, 'DELETE');
        const instancesEmpty = await instanceSnapshot('instances-empty', true);
        assert.deepEqual(instancesEmpty.requests[0].response.body, []);
        activeSocket = socketPath;
        await harness.stop('preview');
        let stopped;
        const stoppedDeadline = Date.now() + 15000;
        while (Date.now() < stoppedDeadline) {
            stopped = await snapshot('dashboard-stopped');
            if (stopped.requests[0].response.body.online === false) break;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        assert.equal(stopped.requests[0].response.body.online, false);
        assert.equal(stopped.requests[0].response.body.code, 'CADDY_STATUS_UNAVAILABLE');
        let sidebarStopped;
        const sidebarStoppedDeadline = Date.now() + 15000;
        while (Date.now() < sidebarStoppedDeadline) {
            sidebarStopped = await sidebarSnapshot('sidebar-stopped');
            if (sidebarStopped.requests[3].response.body.online === false) break;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        assert.equal(sidebarOnline.requests[3].response.body.online, true);
        assert.equal(sidebarStopped.requests[3].response.body.online, false);
        const { stdout: commit } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
        result = validateCapture({ formatVersion: CAPTURE_VERSION,
            source: { commit: commit.trim(), sourceHash: await sourceFingerprint(), caddyImage: IMAGE },
            csrfContext: { source: { commit: commit.trim() }, record: csrfRecord },
            normalization: ['Request IDs', 'ISO timestamps', 'Private capture addresses and paths; measurements remain as observed'],
            scenarios: normalizeCapture([online, noServers, stopped, notifications, metrics, logs, tls, sidebarOnline, sidebarStopped, routesOnline, routesEmpty, history, caddyfileEmpty, caddyfileHistory, routeEdit, tlsValid, tlsOrphaned, uptimePending, instancesLocal, instancesMissing, instancesEmpty], [
                [encodeURIComponent(info.instance.adminUrl), encodeURIComponent('http://caddy-preview:2019')],
                [info.instance.adminUrl, 'http://caddy-preview:2019'],
                [new URL(info.instance.adminUrl).host, 'caddy-preview:2019'],
                [info.instance.containerName, 'caddy-ui-dev-preview'], [directory, '/capture-state'],
                ...logAddresses.map((address, index) => [address, `192.0.2.${index + 10}`]),
            ]),
        });
    } catch (error) { failure = error; }
    const cleanupErrors = [];
    for (const backend of backends) {
        if (backend.exitCode === null && backend.signalCode === null) {
            try {
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => backend.kill('SIGKILL'), 3000);
                    backend.once('close', () => { clearTimeout(timer); resolve(); });
                    backend.once('error', reject);
                    backend.kill('SIGTERM');
                });
            } catch (error) { cleanupErrors.push(error); }
        }
    }
    try { await harness.removeAll({ confirmed: true, purge: true }); } catch (error) { cleanupErrors.push(error); }
    try { await rm(directory, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (failure || cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors].filter(Boolean), 'Capture failed; no artifact was written.', { cause: failure });
    await mkdir(resolve(output, '..'), { recursive: true });
    const temporaryOutput = `${output}.${randomBytes(4).toString('hex')}.tmp`;
    try {
        await writeFile(temporaryOutput, JSON.stringify(result, null, 2) + '\n');
        await rename(temporaryOutput, output);
    } finally { await rm(temporaryOutput, { force: true }); }
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const [output, ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error('Usage: npm run i18n:preview:capture -- [output.json]');
    try {
        const capture = await captureDashboard({ ...(output ? { output: resolve(output) } : {}),
            onNamespace: project => console.log(`Capture owns Docker namespace ${project}.`) });
        console.log(`Captured ${capture.scenarios.length} real localization profiles from ${capture.source.commit}. Resources cleaned up.`);
    } catch (error) { console.error(error, error.cause); process.exitCode = 1; }
}

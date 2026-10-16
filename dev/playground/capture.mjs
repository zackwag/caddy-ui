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

export async function captureDashboard({ output = resolve(import.meta.dirname, 'captures/dashboard.json'), backendEntry = resolve(root, 'src/backend/src/index.js'), onNamespace = () => {} } = {}) {
    if (process.platform === 'win32') throw new Error('Capture requires a Unix socket. Run it in Linux CI, WSL, or a Dev Container; replay works without Docker.');
    await checkDocker();
    const context = process.env.DOCKER_CONTEXT;
    const endpoint = !context && process.env.DOCKER_HOST ? process.env.DOCKER_HOST
        : (await exec('docker', ['context', 'inspect', ...(context ? [context] : []), '--format', '{{.Endpoints.docker.Host}}'])).stdout.trim();
    if (!endpoint.startsWith('unix://')) throw new Error('Capture needs a Unix Docker socket accessible to both the CLI and backend. Use Docker-outside-of-Docker in a Dev Container, WSL, or Linux CI.');
    const directory = await mkdtemp(resolve(tmpdir(), 'caddy-ui-preview-'));
    const harness = new Harness(randomBytes(8).toString('hex'));
    let backend;
    let outputLog = '';
    let result;
    let failure;
    const socketPath = resolve(directory, 'backend.sock');
    const startup = new AbortController();
    const interrupt = () => startup.abort(new Error('Capture interrupted.'));
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    function api(path, method = 'GET', body = null) {
        return new Promise((resolve, reject) => {
            const call = request({ socketPath, path: '/api' + path, method, timeout: 5000, signal: startup.signal,
                headers: { 'Content-Type': 'application/json', 'X-Instance-Id': 'default' } }, response => {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('error', reject);
                response.on('end', () => {
                    try {
                        const text = Buffer.concat(chunks).toString();
                        const headers = Object.fromEntries(['content-type', 'x-request-id'].filter(key => response.headers[key]).map(key => [key, response.headers[key]]));
                        resolve({ request: { method, path, body }, response: {
                            status: response.statusCode, headers,
                            body: headers['content-type']?.includes('application/json') ? JSON.parse(text) : text,
                        } });
                    } catch (error) { reject(error); }
                });
            });
            call.on('timeout', () => call.destroy(new Error(`Capture request timed out: ${method} ${path}`)));
            call.on('error', reject);
            if (body !== null) call.write(JSON.stringify(body));
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
        backend = spawn(process.execPath, [backendEntry], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
        for (const stream of [backend.stdout, backend.stderr]) stream.on('data', data => { outputLog = (outputLog + data).slice(-64000); });
        backend.on('error', error => startup.abort(error));
        backend.once('close', (code, signal) => startup.abort(new Error(`Capture backend exited (${code ?? signal}).\n${outputLog}`)));
        const deadline = Date.now() + 15000;
        let ready = false;
        while (Date.now() < deadline) {
            startup.signal.throwIfAborted();
            try {
                const version = await api('/version');
                if (version.response.body.version === env.APP_VERSION) { ready = true; break; }
            } catch { startup.signal.throwIfAborted(); }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        startup.signal.throwIfAborted();
        if (!ready) throw new Error(`Capture backend did not become ready.\n${outputLog}`);
        await successful('/metrics/config', 'PUT', { enabled: true });
        const label = await successful('/server-names/srv0', 'PUT', { name: 'Playground HTTP' });
        const online = await snapshot('dashboard-online');
        assert(online.requests.every(record => record.response.status === 200));
        assert(Array.isArray(online.requests[3].response.body));
        assert.equal(online.requests[0].response.body.online, true);
        assert(online.requests[0].response.body.servers.length > 0);
        assert.equal(online.requests[1].response.body.ok, true);
        online.requests.push(label);
        // Read untouched defaults from this capture's private state directory.
        // Never configure a real destination or send a notification for preview data.
        const notifications = { id: 'notifications-default', requests: [await successful('/notifications/config')] };
        assert.equal(notifications.requests[0].response.body.enabled, false);
        assert.equal(notifications.requests[0].response.body.provider, 'ntfy');
        const adminHeaders = { 'Content-Type': 'application/json', Origin: 'http://0.0.0.0:2019' };
        const original = await (await fetch(info.instance.adminUrl + '/config/', { headers: adminHeaders, signal: AbortSignal.any([startup.signal, AbortSignal.timeout(5000)]) })).json();
        const empty = structuredClone(original);
        empty.apps.http.servers = {};
        const reload = await fetch(info.instance.adminUrl + '/load', { method: 'POST', headers: adminHeaders, body: JSON.stringify(empty), signal: AbortSignal.any([startup.signal, AbortSignal.timeout(5000)]) });
        assert.equal(reload.ok, true, await reload.text());
        const noServers = await snapshot('dashboard-empty');
        assert.equal(noServers.requests[0].response.body.online, true);
        assert.equal(noServers.requests[0].response.body.serverCount, 0);
        await harness.stop('preview');
        const stopped = await snapshot('dashboard-stopped');
        assert.equal(stopped.requests[0].response.body.online, false);
        assert.equal(stopped.requests[0].response.body.code, 'CADDY_STATUS_UNAVAILABLE');
        const { stdout: commit } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
        result = validateCapture({ formatVersion: CAPTURE_VERSION,
            source: { commit: commit.trim(), sourceHash: await sourceFingerprint(), caddyImage: IMAGE },
            normalization: ['Request IDs', 'ISO timestamps', 'Private capture addresses and paths; measurements remain as observed'],
            scenarios: normalizeCapture([online, noServers, stopped, notifications], [
                [info.instance.adminUrl, 'http://caddy-preview:2019'],
                [new URL(info.instance.adminUrl).host, 'caddy-preview:2019'],
                [info.instance.containerName, 'caddy-ui-dev-preview'], [directory, '/capture-state'],
            ]),
        });
    } catch (error) { failure = error; }
    const cleanupErrors = [];
    if (backend && backend.exitCode === null && backend.signalCode === null) {
        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => backend.kill('SIGKILL'), 3000);
                backend.once('close', () => { clearTimeout(timer); resolve(); });
                backend.once('error', reject);
                backend.kill('SIGTERM');
            });
        } catch (error) { cleanupErrors.push(error); }
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
        console.log(`Captured ${capture.scenarios.length} real Dashboard/configuration profiles from ${capture.source.commit}. Resources cleaned up.`);
    } catch (error) { console.error(error, error.cause); process.exitCode = 1; }
}

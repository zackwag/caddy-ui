import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { backendEnvironment, checkDocker, Harness, IMAGE } from '../../dev/dev-caddy/harness.mjs';
import { CAPTURE_VERSION, normalizeCapture, validateCapture } from '../../dev/playground/capture-format.js';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');

const CADDYFILE_RICH = `{
    admin 0.0.0.0:2019
    auto_https off
}

:80 {
    log {
        output file /data/dev-caddy/logs/access.log
        format json
    }

    handle /api/* {
        reverse_proxy 192.168.1.10:8080
    }

    handle /media/* {
        reverse_proxy 192.168.1.20:8096
    }

    respond /health "ok" 200
    respond "Screenshot capture instance" 200
}
`;

export async function captureScreenshots({ output = resolve(import.meta.dirname, 'captures/screenshots.json'), backendEntry = resolve(root, 'src/backend/src/index.js'), onNamespace = () => {} } = {}) {
    if (process.platform === 'win32') throw new Error('Capture requires a Unix socket.');
    await checkDocker();
    const context = process.env.DOCKER_CONTEXT;
    const endpoint = !context && process.env.DOCKER_HOST ? process.env.DOCKER_HOST
        : (await exec('docker', ['context', 'inspect', ...(context ? [context] : []), '--format', '{{.Endpoints.docker.Host}}'])).stdout.trim();
    if (!endpoint.startsWith('unix://')) throw new Error('Capture needs a Unix Docker socket.');
    const directory = await mkdtemp(resolve(tmpdir(), 'caddy-ui-screenshots-'));
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

    try {
        onNamespace(harness.project);
        assert.deepEqual(await harness.names(), []);
        assert.deepEqual(await harness.names('volume'), []);
        const info = await harness.create('screenshots');
        const env = { ...backendEnvironment(directory, info.instance), PORT: socketPath,
            DOCKER_SOCKET: fileURLToPath(endpoint.replace(/^unix:/, 'file:')),
            APP_VERSION: '1.20.0', CADDY_UI_PUBLIC_METRICS: 'false', CADDY_UI_ADDITIONAL_LANGUAGES: '',
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

        // Enrich state: enable metrics, set server label, add route note.
        await successful('/metrics/config', 'PUT', { enabled: true });
        await successful('/server-names/srv0', 'PUT', { name: 'Production HTTPS' });
        await successful('/route-notes', 'PUT', { notes: { ':80/api/*': 'Home Assistant API' } });

        // Write the richer Caddyfile and reload so routes are visible.
        const adminHeaders = { 'Content-Type': 'text/caddyfile', Origin: 'http://0.0.0.0:2019' };
        const loadResult = await fetch(info.instance.adminUrl + '/load', { method: 'POST', headers: adminHeaders, body: CADDYFILE_RICH, signal: AbortSignal.any([startup.signal, AbortSignal.timeout(5000)]) });
        assert.equal(loadResult.ok, true, await loadResult.text());

        // Generate some log entries by hitting the Caddy instance.
        for (let i = 0; i < 5; i++) {
            await fetch(info.httpUrl + '/health', { signal: AbortSignal.timeout(2000) }).catch(() => {});
            await fetch(info.httpUrl + '/', { signal: AbortSignal.timeout(2000) }).catch(() => {});
        }
        await new Promise(resolve => setTimeout(resolve, 500));

        // Save caddyfile to create a history entry.
        await successful('/caddyfile', 'PUT', { content: CADDYFILE_RICH });

        // Configure notifications (provider config, not sending).
        await successful('/notifications/config', 'PUT', {
            enabled: true, provider: 'ntfy', ntfyUrl: 'https://ntfy.example.com/caddy-alerts',
            triggers: { upstreamOffline: true, upstreamOnline: true, certExpiring: true, updateAvailable: true },
            cooldownMinutes: 30,
        });

        // Add a second manual instance for the instances view.
        await successful('/instances', 'POST', {
            name: 'Staging Server', adminUrl: 'http://192.168.1.50:2019',
            configPath: '/etc/caddy/Caddyfile', logPath: '/var/log/caddy/access.log',
            dataPath: '/var/lib/caddy', containerName: '', serverName: 'srv0',
        });

        // Capture global endpoints.
        const requests = [];
        requests.push(await api('/settings'));
        requests.push(await api('/custom-themes'));
        requests.push(await api('/version'));
        requests.push(await api('/instances'));
        const authCheck = await api('/auth/check');
        requests.push(authCheck);

        // Dashboard.
        requests.push(await api('/status'));
        requests.push(await api('/status/process'));
        requests.push(await api('/server-names'));
        requests.push(await api('/health'));

        // Caddyfile.
        requests.push(await api('/caddyfile'));
        requests.push(await api('/caddyfile/history'));

        // Routes.
        requests.push(await api('/routes'));
        requests.push(await api('/tls'));
        requests.push(await api('/route-notes'));
        requests.push(await api('/routes/maintenance'));
        requests.push(await api('/health/uptime'));
        requests.push(await api('/health/uptime?kind=route'));

        // TLS (shares /tls from routes above).

        // Logs.
        requests.push(await api('/logs'));
        requests.push(await api('/logs/config'));

        // Metrics.
        requests.push(await api('/metrics'));
        requests.push(await api('/metrics/config'));

        // Notifications.
        requests.push(await api('/notifications/config'));

        // Instances — server-names/all and per-instance server query.
        requests.push(await api('/server-names/all'));

        const { stdout: commit } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
        result = validateCapture({ formatVersion: CAPTURE_VERSION,
            source: { commit: commit.trim(), caddyImage: IMAGE },
            normalization: ['Request IDs', 'ISO timestamps', 'Private capture addresses and paths; measurements remain as observed'],
            scenarios: normalizeCapture([{ id: 'screenshots', requests }], [
                [info.instance.adminUrl, 'http://caddy-screenshots:2019'],
                [new URL(info.instance.adminUrl).host, 'caddy-screenshots:2019'],
                [info.httpUrl, 'http://caddy-screenshots:80'],
                [new URL(info.httpUrl).host, 'caddy-screenshots:80'],
                [info.instance.containerName, 'caddy-ui-dev-screenshots'], [directory, '/capture-state'],
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
    if (extra.length) throw new Error('Usage: node docs/screenshots/capture.mjs [output.json]');
    try {
        const capture = await captureScreenshots({ ...(output ? { output: resolve(output) } : {}),
            onNamespace: project => console.log(`Capture owns Docker namespace ${project}.`) });
        console.log(`Captured ${capture.scenarios[0].requests.length} API responses from ${capture.source.commit}. Resources cleaned up.`);
    } catch (error) { console.error(error, error.cause); process.exitCode = 1; }
}

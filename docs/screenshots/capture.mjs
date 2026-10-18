import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { backendEnvironment, checkDocker, docker, Harness, IMAGE } from '../../dev/dev-caddy/harness.mjs';
import { CAPTURE_VERSION, normalizeCapture, validateCapture } from '../../dev/playground/capture-format.js';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');

// Each site proxies to its own port on the second owned Caddy; `service` is
// the address shown in the capture in place of that Caddy's private IP.
const SITES = [
    { domain: 'example.com', title: 'Home Assistant', port: 8123, service: 'homeassistant' },
    { domain: 'media.home.arpa', title: 'Jellyfin', port: 8096, service: 'jellyfin' },
    { domain: 'api.internal', title: 'Internal API', port: 8080, service: 'api' },
];

function screenshotCaddyfile(address) {
    return `{
    admin 0.0.0.0:2019
    auto_https disable_redirects
    metrics
    log {
        output file /data/dev-caddy/logs/access.log
        format json
        include http.log.access
    }
}

${SITES.map(({ domain, title, port }) => `${domain} {
    # ${title}
    tls internal
    log
    reverse_proxy ${address}:${port}
}`).join('\n\n')}
`;
}

function upstreamCaddyfile() {
    return `{
    admin 0.0.0.0:2019
    auto_https off
}

${SITES.map(site => ':' + site.port).join(', ')} {
    respond /error "deliberate test error" 503
    respond "OK" 200
}
`;
}

// Seed the normal persisted history format, not an invented API response.
// These illustrative samples are distinct from the traffic measured below.
async function seedHistory(path, address) {
    const now = Date.now();
    const entries = Array.from({ length: 48 }, (_, i) => ({ at: now - (48 - i) * 30 * 60_000, online: i !== 10 }));
    const entry = { firstSeen: entries[0].at, entries };
    await writeFile(path, JSON.stringify(Object.fromEntries([
        ...SITES.map(site => ['default:' + address + ':' + site.port, entry]),
        ...SITES.map(site => ['default#' + site.domain, entry]),
    ])));
}

// Only HTTP and the admin API are published, so request the HTTPS sites from
// inside the container. Prints "<domain> <path> <status>" per request.
function trafficScript(paths) {
    const domains = SITES.map(site => site.domain).join(' ');
    return `echo "127.0.0.1 ${domains}" >> /etc/hosts
for domain in ${domains}; do
    for path in ${paths.join(' ')}; do
        status=$(wget -S --no-check-certificate -O /dev/null "https://$domain$path" 2>&1 | awk '$1 ~ /^HTTP\\// { print $2 }' | tail -n 1)
        echo "$domain $path $status"
    done
done`;
}

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

    let requestContext = {};
    async function api(path, method = 'GET', body = null) {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !requestContext['X-CSRF-Token']) await api('/auth/csrf');
        return new Promise((resolve, reject) => {
            const call = request({ socketPath, path: '/api' + path, method, timeout: 5000, signal: startup.signal,
                headers: { ...requestContext, 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json', 'X-Instance-Id': 'default' } }, response => {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('error', reject);
                response.on('end', () => {
                    try {
                        const text = Buffer.concat(chunks).toString();
                        const headers = Object.fromEntries(['content-type', 'x-request-id'].filter(key => response.headers[key]).map(key => [key, response.headers[key]]));
                        const cookie = response.headers['set-cookie']?.at(-1);
                        if (cookie) requestContext = { Cookie: cookie.split(';')[0] };
                        if (path === '/auth/csrf') requestContext['X-CSRF-Token'] = JSON.parse(text).csrfToken;
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

    try {
        onNamespace(harness.project);
        assert.deepEqual(await harness.names(), []);
        assert.deepEqual(await harness.names('volume'), []);
        const info = await harness.create('screenshots');
        const staging = await harness.create('staging');
        // Caddy reaches its peer on the Docker network, not the host's
        // published loopback port returned for a local CLI client.
        const stagingContainer = await harness.inspect('container', staging.instance.containerName);
        // Docker names its default network "bridge"; other engines may not.
        const networks = stagingContainer.NetworkSettings.Networks;
        const address = (networks[await harness.network() || 'bridge'] ?? Object.values(networks)[0]).IPAddress;
        const appVersion = JSON.parse(await readFile(resolve(root, '.release-please-manifest.json'), 'utf8'))['.'];
        const env = { ...backendEnvironment(directory, info.instance), PORT: socketPath,
            DOCKER_SOCKET: fileURLToPath(endpoint.replace(/^unix:/, 'file:')),
            APP_VERSION: appVersion, CADDY_UI_PUBLIC_METRICS: 'false', CADDY_UI_ADDITIONAL_LANGUAGES: '',
            CADDY_SERVER_NAME: 'srv0', NODE_ENV: 'development' };
        for (const key of ['CADDY_UI_USER', 'CADDY_UI_PASSWORD', 'JWT_SECRET']) delete env[key];
        await mkdir(resolve(directory, 'backend'), { recursive: true });
        await seedHistory(env.UPTIME_HISTORY_PATH, address);
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

        await successful('/auth/setup', 'POST', { username: 'capture-administrator', password: randomBytes(24).toString('base64url') });
        await successful('/settings', 'PUT', { firstTimeRun: false, language: 'en', theme: 'dark' });

        // Give each example site its own upstream on the second owned Caddy.
        const loaded = await fetch(staging.instance.adminUrl + '/load', { method: 'POST', body: upstreamCaddyfile(),
            headers: { 'Content-Type': 'text/caddyfile', Origin: 'http://0.0.0.0:2019' },
            signal: AbortSignal.any([startup.signal, AbortSignal.timeout(5000)]) });
        assert(loaded.ok, await loaded.text());

        // Exercise the real session/CSRF-protected configuration-write path.
        await successful('/server-names/srv0', 'PUT', { name: 'Production HTTPS' });
        await successful('/caddyfile?fmt=false&sort=false', 'PUT', screenshotCaddyfile(address));
        for (const site of SITES) await successful('/route-notes/' + encodeURIComponent(site.domain), 'PUT', { note: site.title });

        // Local certificates are issued asynchronously; wait for actual storage.
        const certificateDeadline = Date.now() + 15000;
        while ((await successful('/tls')).response.body.length < SITES.length) {
            assert(Date.now() < certificateDeadline, 'Caddy did not issue the example site certificates');
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Populate logs and request counters with real HTTPS traffic to owned services.
        const paths = ['/', '/media', '/error'];
        const traffic = await docker(['exec', info.instance.containerName, 'sh', '-c', trafficScript(paths)]);
        assert.deepEqual(traffic.trim().split('\n'), SITES.flatMap(site => paths.map(path => `${site.domain} ${path} ${path === '/error' ? 503 : 200}`)));

        // Configure notifications. Nothing is sent: upstreams stay online, the
        // first check only records a baseline, and expiry alerts skip local
        // certificates. The update check would query GitHub, so it stays off.
        await successful('/notifications/config', 'PUT', {
            enabled: true, provider: 'ntfy', ntfy: { url: 'https://ntfy.example.com/caddy-alerts' },
            triggers: { upstreamOffline: true, upstreamOnline: true, certExpiring: true, updateAvailable: false, routeOffline: true, routeOnline: true },
            debounceMinutes: 30,
        });

        // Both entries belong to disposable Caddy instances, so capture never
        // probes an unrelated LAN service to populate the Instances view.
        await successful('/instances', 'POST', {
            ...staging.instance, name: 'Staging Server',
        });

        // Capture global endpoints.
        const requests = [];
        requests.push(await successful('/languages'));
        requests.push(await successful('/settings'));
        requests.push(await successful('/custom-themes'));
        requests.push(await successful('/version'));
        // The renderer builds the frontend as this version, so the footer shows one.
        requests.push(await successful('/version?frontend=' + encodeURIComponent(appVersion)));
        requests.push(await successful('/instances'));
        requests.push(await successful('/instances/status'));
        requests.push(await successful('/auth/status'));

        // Dashboard.
        requests.push(await successful('/status'));
        requests.push(await successful('/status/process'));
        requests.push(await successful('/server-names'));
        requests.push(await successful('/health'));

        // Caddyfile.
        requests.push(await successful('/caddyfile'));
        const history = await successful('/caddyfile/history');
        requests.push(history);
        for (const entry of history.response.body) requests.push(await successful('/caddyfile/history/' + encodeURIComponent(entry.filename)));

        // Routes.
        requests.push(await successful('/routes'));
        requests.push(await successful('/tls'));
        requests.push(await successful('/route-notes'));
        requests.push(await successful('/routes/maintenance'));
        requests.push(await successful('/health/uptime'));
        requests.push(await successful('/health/uptime?kind=route'));

        // TLS (shares /tls from routes above).

        // Logs.
        requests.push(await successful('/logs'));
        requests.push(await successful('/logs/config'));

        // Metrics.
        requests.push(await successful('/metrics'));
        requests.push(await successful('/metrics/config'));

        // Notifications.
        requests.push(await successful('/notifications/config'));

        // Instances — server-names/all and per-instance server query.
        requests.push(await successful('/server-names/all'));
        requests.push(await successful('/instances/servers?adminUrl=' + encodeURIComponent(info.instance.adminUrl)));
        requests.push(await successful('/instances/servers?adminUrl=' + encodeURIComponent(staging.instance.adminUrl)));

        const { stdout: commit } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
        result = validateCapture({ formatVersion: CAPTURE_VERSION,
            source: { commit: commit.trim(), caddyImage: IMAGE, sampleHistory: 'Illustrative 24-hour uptime history seeded into backend storage; request metrics and certificates are generated live.' },
            normalization: ['Request IDs', 'ISO timestamps', 'Private capture addresses and paths; measurements remain as observed'],
            scenarios: normalizeCapture([{ id: 'screenshots', requests }], [
                [encodeURIComponent(staging.instance.adminUrl), encodeURIComponent('http://caddy-staging:2019')],
                [staging.instance.adminUrl, 'http://caddy-staging:2019'],
                [staging.instance.containerName, 'caddy-ui-dev-staging'],
                ...SITES.map(site => [address + ':' + site.port, site.service + ':' + site.port]),
                [encodeURIComponent(info.instance.adminUrl), encodeURIComponent('http://caddy-screenshots:2019')],
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

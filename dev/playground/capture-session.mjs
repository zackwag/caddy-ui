import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { checkDocker, Harness, IMAGE, isolatedBackendEnvironment, until as poll } from '../dev-caddy/harness.mjs';
import { spawnBackend, stopProcess } from '../integration/stack.mjs';
import { CAPTURE_VERSION, normalizeCapture, validateCapture } from './capture-format.js';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');

async function dockerSocket() {
    await checkDocker();
    const context = process.env.DOCKER_CONTEXT;
    const endpoint = !context && process.env.DOCKER_HOST ? process.env.DOCKER_HOST
        : (await exec('docker', ['context', 'inspect', ...(context ? [context] : []), '--format', '{{.Endpoints.docker.Host}}'])).stdout.trim();
    if (!endpoint.startsWith('unix://')) throw new Error('Capture needs a Unix Docker socket accessible to both the CLI and backend. Use Docker-outside-of-Docker in a Dev Container, WSL, or Linux CI.');
    return fileURLToPath(endpoint.replace(/^unix:/, 'file:'));
}

// The API of one backend, as [{ request, response }] records. Cookies and the
// CSRF token stay here, out of the records.
function apiClient(socketPath, signal) {
    let context = {};
    async function api(path, method = 'GET', body = null) {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !context['X-CSRF-Token']) await api('/auth/csrf');
        return new Promise((resolve, reject) => {
            const call = request({ socketPath, path: '/api' + path, method, timeout: 5000, signal,
                headers: { ...context, 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json', 'X-Instance-Id': 'default' } }, response => {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('error', reject);
                response.on('end', () => {
                    try {
                        const text = Buffer.concat(chunks).toString();
                        const headers = Object.fromEntries(['content-type', 'x-request-id'].filter(key => response.headers[key]).map(key => [key, response.headers[key]]));
                        const cookie = response.headers['set-cookie']?.at(-1);
                        if (cookie) context = { Cookie: cookie.split(';')[0] };
                        if (path === '/auth/csrf') context['X-CSRF-Token'] = JSON.parse(text).csrfToken;
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
    return { api, successful };
}

// Records real API responses from backends and Caddy instances this capture
// owns, and writes them to `output` once everything is cleaned up. `record` gets
// the session below and resolves to { scenarios, replacements }, plus anything
// else the capture file keeps.
export async function runCapture({ name, output, backendEntry = resolve(root, 'src/backend/src/index.js'), onNamespace = () => {}, onBackend = () => {} }, record) {
    if (process.platform === 'win32') throw new Error('Capture requires a Unix socket. Run it in Linux CI, WSL, or a Dev Container; replay works without Docker.');
    const DOCKER_SOCKET = await dockerSocket();
    const directory = await mkdtemp(resolve(tmpdir(), `caddy-ui-${name}-`));
    const harness = new Harness(randomBytes(8).toString('hex'));
    const backends = [];
    const startup = new AbortController();
    const { signal } = startup;
    const interrupt = () => startup.abort(new Error('Capture interrupted.'));
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);

    const until = (read, done, message) => poll(read, done, { signal, intervalMs: 250, message });

    const session = {
        harness, directory, signal, until,
        // A backend's environment, listening on a socket in its own state directory.
        environment: (instance, overrides = {}, stateDirectory = directory) => isolatedBackendEnvironment(stateDirectory, instance, {
            PORT: resolve(stateDirectory, 'backend.sock'), DOCKER_SOCKET, CADDY_SERVER_NAME: 'srv0', ...overrides,
        }),
        // Starts and enrolls a backend; resolves to its API once it answers.
        async startBackend(env) {
            await mkdir(resolve(env.AUTH_PATH, '..'), { recursive: true });
            const { backend, output: log } = spawnBackend({ env, backendEntry });
            backends.push(backend);
            backend.on('error', error => startup.abort(error));
            backend.once('close', (code, reason) => startup.abort(new Error(`Capture backend exited (${code ?? reason}).\n${log()}`)));
            onBackend(backend.pid);
            const client = apiClient(env.PORT, signal);
            await until(() => client.api('/version').catch(() => null), version => version?.response.body.version === env.APP_VERSION,
                'Capture backend did not become ready.').catch(cause => { throw new Error(`${cause.message}\n${log()}`, { cause }); });
            await client.successful('/auth/setup', 'POST', { username: 'capture-administrator', password: randomBytes(24).toString('base64url') });
            return client;
        },
    };

    let result;
    let failure;
    try {
        onNamespace(harness.project);
        assert.deepEqual(await harness.names(), []);
        assert.deepEqual(await harness.names('volume'), []);
        const commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
        const { scenarios, replacements, source = {}, ...rest } = await record(session, commit);
        result = validateCapture({
            formatVersion: CAPTURE_VERSION,
            source: { commit, caddyImage: IMAGE, ...source },
            ...rest,
            normalization: ['Request IDs', 'ISO timestamps', 'Private capture addresses and paths; measurements remain as observed'],
            scenarios: normalizeCapture(scenarios, [...replacements, [directory, '/capture-state']]),
        });
    } catch (error) { failure = error; }

    const cleanups = [...backends.map(backend => () => stopProcess(backend)),
        () => harness.removeAll({ confirmed: true, purge: true }),
        () => rm(directory, { recursive: true, force: true })];
    const cleanupErrors = [];
    for (const cleanup of cleanups) {
        try { await cleanup(); } catch (error) { cleanupErrors.push(error); }
    }
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

// Replacements that hide one instance's addresses behind a stable host name.
export function hideInstance({ instance, httpUrl }, host) {
    return [
        [encodeURIComponent(instance.adminUrl), encodeURIComponent(`http://${host}:2019`)],
        [instance.adminUrl, `http://${host}:2019`],
        [new URL(instance.adminUrl).host, `${host}:2019`],
        ...(httpUrl ? [[httpUrl, `http://${host}:80`], [new URL(httpUrl).host, `${host}:80`]] : []),
        [instance.containerName, host.replace(/^caddy-/, 'caddy-ui-dev-')],
    ];
}

// Runs a capture from the command line when `moduleUrl` is the script node started.
export async function captureFromCommandLine(moduleUrl, capture, describe) {
    if (!process.argv[1] || moduleUrl !== pathToFileURL(resolve(process.argv[1])).href) return;
    const [output, ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error(`Usage: node ${process.argv[1]} [output.json]`);
    try {
        const result = await capture({ ...(output ? { output: resolve(output) } : {}),
            onNamespace: project => console.log(`Capture owns Docker namespace ${project}.`) });
        console.log(`${describe(result)} from ${result.source.commit}. Resources cleaned up.`);
    } catch (error) { console.error(error, error.cause); process.exitCode = 1; }
}

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { backendEnvironment, checkDocker, Harness } from './harness.mjs';

const root = resolve(import.meta.dirname, '../..');
const VERSION = 'dev-caddy-integration';

export async function waitFor(url, accept = response => response.ok, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now()))) });
            if (await accept(response)) return;
        } catch (error) { lastError = error; }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Readiness timeout at ${url}`, { cause: lastError });
}

async function availablePort() {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

async function stopProcess(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await exited; } finally { clearTimeout(force); }
}

// Each suite owns fresh resources and a temporary registry. It never uses .dev-caddy.
export async function startTestStack({ project = randomBytes(8).toString('hex'), backendEntry = 'backend/src/index.js' } = {}) {
    await checkDocker();
    const harness = new Harness(project);
    if ((await harness.names()).length || (await harness.names('volume')).length) {
        throw new Error('Integration tests require a fresh, empty Docker namespace');
    }
    const directory = await mkdtemp(join(tmpdir(), 'caddy-ui-integration-'));
    const instances = new Map();
    let backend;
    let output = '';
    let startupError;
    let cleanup;
    const close = () => cleanup ??= (async () => {
        // Cleanup all layers even if stopping a process or removing a resource fails.
        const errors = [];
        for (const action of [
            () => stopProcess(backend),
            () => harness.removeAll({ confirmed: true, purge: true }),
            () => rm(directory, { recursive: true, force: true }),
        ]) {
            try { await action(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Integration cleanup failed');
    })();

    try {
        const first = await harness.create('alpha');
        instances.set('alpha', first);
        await waitFor(first.httpUrl + '/health');
        await waitFor(first.instance.adminUrl + '/config/');
        const port = await availablePort();
        const version = VERSION + '-' + project;
        const env = { ...backendEnvironment(directory, first.instance), PORT: String(port), APP_VERSION: version, LOG_LEVEL: 'info', CADDY_UI_ADDITIONAL_LANGUAGES: 'de' };
        for (const key of ['CADDY_UI_USER', 'CADDY_UI_PASSWORD', 'JWT_SECRET']) delete env[key];
        await mkdir(join(directory, 'backend'), { recursive: true });
        await writeFile(env.INSTANCES_PATH, JSON.stringify([{ id: 'default', ...first.instance }]));
        await writeFile(env.SETTINGS_PATH, JSON.stringify({ firstTimeRun: false, theme: 'dark', language: 'en', routeChecks: false }));
        backend = spawn(process.execPath, [resolve(root, backendEntry)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
        for (const stream of [backend.stdout, backend.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-64000); });
        backend.on('error', error => { startupError = error; });
        const url = `http://127.0.0.1:${port}`;
        await waitFor(url + '/api/version', async response => {
            if (startupError || backend.exitCode !== null) throw startupError || new Error('Backend exited before readiness');
            return response.ok && (await response.json()).version === version;
        });
        return {
            harness, directory, url, instances, close,
            async api(path, { method = 'GET', body, instanceId = 'default', plain = false } = {}) {
                const response = await fetch(url + '/api' + path, {
                    method,
                    headers: { 'X-Instance-Id': instanceId, ...(body === undefined ? {} : { 'Content-Type': plain ? 'text/plain' : 'application/json' }) },
                    ...(body === undefined ? {} : { body: plain ? body : JSON.stringify(body) }),
                    signal: AbortSignal.timeout(15000),
                });
                const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
                return { status: response.status, requestId: response.headers.get('X-Request-ID'), data };
            },
            async create(name) {
                const info = await harness.create(name);
                await waitFor(info.httpUrl + '/health');
                instances.set(name, info);
                return info;
            },
        };
    } catch (error) {
        try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Integration startup and cleanup failed', { cause: cleanupError }); }
        throw new Error(`Integration startup failed: ${error.message}\n${output}`, { cause: error });
    }
}

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { backendEnvironment, checkDocker, Harness, IMAGE } from '../../scripts/dev-caddy/harness.mjs';
import { FixtureScope } from './lifecycle.mjs';

const root = resolve(import.meta.dirname, '../..');
const VERSION = 'dev-caddy-integration';

export async function claimNamespace(harness) {
    try {
        return await harness.run(['create', '--name', `caddy-ui-test-${harness.project}-lease`,
            '--label', 'io.caddy-ui.test-fixture=true', '--label', `io.caddy-ui.test-project=${harness.project}`,
            '--network', 'none', '--entrypoint', 'sh', IMAGE, '-c', 'true']);
    } catch (cause) {
        if (/already in use/.test(cause.stderr || cause.message)) {
            throw new Error('Integration tests require a fresh, empty Docker namespace; another fixture already holds its lease', { cause });
        }
        throw cause;
    }
}

export async function waitForHttp(url, { accept = response => response.ok, timeoutMs = 15000, signal } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        signal?.throwIfAborted();
        try {
            const timeout = AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now())));
            const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
            if (await accept(response)) {
                signal?.throwIfAborted();
                return response;
            }
        } catch (error) {
            // Process failures are terminal, even when fetch never connects.
            signal?.throwIfAborted();
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    signal?.throwIfAborted();
    throw new Error(`Readiness timeout at ${url}`, { cause: lastError });
}

export function waitForBackendPort(backend, { signal, timeoutMs = 15000 } = {}) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(reject, new Error('Backend did not report its listening port before readiness')), timeoutMs);
        const onAbort = () => finish(reject, signal.reason);
        const onMessage = message => {
            if (message?.type !== 'caddy-ui:listening') return;
            if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
                finish(reject, new Error('Backend reported an invalid listening port'));
                return;
            }
            finish(resolve, message.port);
        };
        function finish(settle, value) {
            clearTimeout(timer);
            backend.removeListener('message', onMessage);
            signal?.removeEventListener('abort', onAbort);
            settle(value);
        }
        backend.on('message', onMessage);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
    });
}

async function stopProcess(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await exited; } finally { clearTimeout(force); }
}

// Each suite owns fresh resources and a temporary registry. It never uses .dev-caddy.
export function useTestStack(t, options = {}) {
    const signal = options.signal ? AbortSignal.any([t.signal, options.signal]) : t.signal;
    const scope = new FixtureScope(signal);
    t.after(() => scope.close());
    return createTestStack(scope, options);
}

// Browser fixtures pass their owner here so all services share one cleanup order.
export async function createTestStack(scope, { project = randomBytes(8).toString('hex'), backendEntry = 'backend/src/index.js' } = {}) {
    const instances = new Map();
    let output = '';
    const close = () => scope.close();

    try {
        const harness = new Harness(project);
        await scope.run(() => checkDocker());
        // Docker's container-name claim is atomic across processes and clients.
        // Retain this stopped, unmounted container until every cleanup completes.
        await scope.acquire(() => claimNamespace(harness), id => harness.run(['rm', id]));
        const [containers, volumes] = await scope.run(() => Promise.all([harness.names(), harness.names('volume')]));
        if (containers.length || volumes.length) throw new Error('Integration tests require a fresh, empty Docker namespace');
        const directory = await scope.acquire(() => mkdtemp(join(tmpdir(), 'caddy-ui-integration-')),
            directory => rm(directory, { recursive: true, force: true }));
        scope.defer(() => harness.removeAll({ confirmed: true, purge: true }));
        const first = await scope.run(() => harness.create('alpha'));
        instances.set('alpha', first);
        await waitForHttp(first.httpUrl + '/health', { signal: scope.signal });
        await waitForHttp(first.instance.adminUrl + '/config/', { signal: scope.signal });
        const version = VERSION + '-' + project;
        const env = { ...backendEnvironment(directory, first.instance), PORT: '0', APP_VERSION: version, LOG_LEVEL: 'info', CADDY_UI_ADDITIONAL_LANGUAGES: 'de' };
        for (const key of ['CADDY_UI_USER', 'CADDY_UI_PASSWORD', 'JWT_SECRET']) delete env[key];
        await scope.run(async () => {
            await mkdir(join(directory, 'backend'), { recursive: true });
            await writeFile(env.INSTANCES_PATH, JSON.stringify([{ id: 'default', ...first.instance }]));
            await writeFile(env.SETTINGS_PATH, JSON.stringify({ firstTimeRun: false, theme: 'dark', language: 'en', routeChecks: false }));
        });
        const backend = await scope.acquire(() => spawn(process.execPath, [resolve(root, backendEntry)],
            { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }), stopProcess);
        for (const stream of [backend.stdout, backend.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-64000); });
        const startup = new AbortController();
        backend.on('error', error => startup.abort(error));
        // close follows stdout/stderr draining, so startup diagnostics are complete.
        backend.once('close', (code, signal) => startup.abort(new Error(`Backend exited (${code ?? signal}) before readiness`)));
        const readySignal = AbortSignal.any([scope.signal, startup.signal]);
        const port = await waitForBackendPort(backend, { signal: readySignal });
        const url = `http://127.0.0.1:${port}`;
        await waitForHttp(url + '/api/version', {
            accept: async response => response.ok && (await response.json()).version === version,
            signal: readySignal,
        });
        return {
            harness, directory, url, instances, close,
            async api(path, { method = 'GET', body, instanceId = 'default', plain = false } = {}) {
                const response = await fetch(url + '/api' + path, {
                    method,
                    headers: { 'X-Instance-Id': instanceId, ...(body === undefined ? {} : { 'Content-Type': plain ? 'text/plain' : 'application/json' }) },
                    ...(body === undefined ? {} : { body: plain ? body : JSON.stringify(body) }),
                    signal: AbortSignal.any([scope.signal, AbortSignal.timeout(15000)]),
                });
                const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
                return { status: response.status, requestId: response.headers.get('X-Request-ID'), data };
            },
            async create(name) {
                const info = await scope.run(() => harness.create(name));
                await waitForHttp(info.httpUrl + '/health', { signal: scope.signal });
                instances.set(name, info);
                return info;
            },
        };
    } catch (error) {
        try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Integration startup and cleanup failed', { cause: cleanupError }); }
        throw new Error(`Integration startup failed: ${error?.message ?? String(error)}\n${output}`, { cause: error });
    }
}

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { backendEnvironment, checkDocker, devFrontendHost, Harness, namespace, STATE, withLock } from './harness.mjs';
import { createExampleInstance } from './examples.mjs';

const root = resolve(import.meta.dirname, '../..');
const children = new Set();
let stopping = false;
let runnerLock;

async function freePort(port) {
    await new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', () => reject(new Error(`Port ${port} is occupied. Stop the other development service before starting this harness.`)));
        server.listen(port, () => server.close(resolve));
    });
}

async function waitFor(url, expected) {
    for (let attempt = 0; attempt < 60; attempt++) {
        if (stopping) throw new Error('Startup interrupted.');
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
            if (response.ok && (!expected || await expected(response))) return;
        } catch { /* Retry while the service starts. */ }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Service did not become ready: ${url}. Check container logs with npm run dev:instances -- list, then docker logs <containerName>.`);
}

function start(command, args, env) {
    if (stopping) throw new Error('Startup interrupted.');
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    children.add(child);
    child.once('error', error => { console.error(error.message); void shutdown(1); });
    child.once('exit', code => {
        children.delete(child);
        if (!stopping) void shutdown(code || 1);
    });
    return child;
}

async function shutdown(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
    const timer = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); }, 3000);
    await Promise.all([...children].map(child => new Promise(resolve => child.once('exit', resolve))));
    clearTimeout(timer);
    if (runnerLock) await rm(runnerLock, { recursive: true });
    process.exitCode = code;
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

try {
    const frontendHost = devFrontendHost(process.env.CADDY_UI_DEV_HOST);
    await freePort(3001);
    await freePort(5173);
    await checkDocker();
    if (stopping) throw new Error('Startup interrupted.');
    await mkdir(STATE, { recursive: true });
    const lock = resolve(STATE, 'runner.lock');
    await mkdir(lock).catch(() => { throw new Error('A dev:with-caddy runner is already active. Remove .dev-caddy/runner.lock only if the previous runner crashed.'); });
    runnerLock = lock;
    const info = await withLock(STATE, async () => createExampleInstance(new Harness(await namespace()), 'default'));
    console.log(JSON.stringify(info, null, 2));
    await waitFor(`${info.instance.adminUrl}/config/`);
    const env = backendEnvironment(STATE, info.instance);
    await mkdir(resolve(STATE, 'backend'), { recursive: true });
    let instances;
    try { instances = JSON.parse(await readFile(env.INSTANCES_PATH, 'utf8')); }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
        instances = [{ id: 'default', ...info.instance }];
    }
    if (!Array.isArray(instances)) throw new Error('Development instances.json must be an array.');
    // Published ports and container IPs can change after recreation. Preserve UI edits.
    instances = instances.map(instance => instance.containerName === info.instance.containerName
        ? { ...instance, adminUrl: info.instance.adminUrl } : instance);
    await writeFile(env.INSTANCES_PATH, JSON.stringify(instances, null, 2));
    start(process.execPath, ['--watch', 'src/backend/src/index.js'], env);
    await waitFor('http://127.0.0.1:3001/api/version', async response => (await response.json()).version === 'dev-caddy');
    // Invoke Vite directly after predev so shutdown controls the server process itself.
    await new Promise((resolve, reject) => {
        const predev = spawn(process.execPath, ['src/frontend/scripts/fetch-caddyfile-mode.mjs'], { cwd: root, env, stdio: 'inherit' });
        children.add(predev);
        predev.once('error', reject);
        predev.once('exit', code => { children.delete(predev); code === 0 ? resolve() : reject(new Error('Frontend predev failed.')); });
    });
    if (!stopping) {
        // Allow the configured reverse-proxy hostname without disabling Vite's host checks.
        if (env.CADDY_UI_EXTERNAL_URL) {
            env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = [env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS,
                new URL(env.CADDY_UI_EXTERNAL_URL).hostname].filter(Boolean).join(',');
        }
        start(process.execPath, ['src/frontend/node_modules/vite/bin/vite.js', 'src/frontend', '--host', frontendHost, '--port', '5173', '--strictPort'], env);
        await waitFor('http://127.0.0.1:5173');
        console.log(`Caddy UI listening on ${frontendHost}:5173 (local: http://localhost:5173). Dev Containers need CADDY_UI_DEV_HOST=0.0.0.0 and a published frontend port for access from the Docker host or a reverse proxy.`);
        console.log('Ctrl-C stops UI processes; Caddy containers/data remain until explicit cleanup.');
    }
} catch (error) {
    console.error(error.message);
    await shutdown(1);
}

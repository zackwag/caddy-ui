import { execFile } from 'node:child_process';
import { inspect, promisify } from 'node:util';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const LABEL = 'io.caddy-ui.dev';
export const IMAGE = 'caddy:2.10.2-alpine';
export const STATE = resolve(import.meta.dirname, '../../.dev-caddy');
const exec = promisify(execFile);

export function devFrontendHost(value = '127.0.0.1') {
    if (!['127.0.0.1', '0.0.0.0'].includes(value)) throw new Error('CADDY_UI_DEV_HOST must be 127.0.0.1 or 0.0.0.0');
    return value;
}

export async function docker(args, { trim = true } = {}) {
    const { stdout } = await exec('docker', args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    return trim ? stdout.trim() : stdout;
}

// Calls `read(remainingMs)` until `done(value)` holds, every `intervalMs` for at
// most `timeoutMs`. A thrown error ends the wait unless `retry(error)` allows
// another attempt. A timeout names the last value or error it observed.
export async function until(read, done = Boolean, { signal, timeoutMs = 15000, intervalMs = 100, retry = () => false, message = 'Condition not met' } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (true) {
        signal?.throwIfAborted();
        try {
            const value = await read(Math.max(1, deadline - Date.now()));
            if (await done(value)) {
                signal?.throwIfAborted();
                return value;
            }
            last = { value };
        } catch (error) {
            // An abort, such as a process exiting, explains the failure better than its symptom.
            signal?.throwIfAborted();
            if (!retry(error)) {
                throw error;
            }
            last = { error };
        }
        if (Date.now() >= deadline) {
            const observed = last.error ? `error: ${last.error.message}` : `value: ${inspect(last.value, { depth: 2, breakLength: Infinity, maxStringLength: 500 })}`;
            throw new Error(`${typeof message === 'function' ? message() : message} (after ${timeoutMs} ms; last ${observed})`, { cause: last.error });
        }
        await delay(intervalMs, undefined, { signal }).catch(() => signal.throwIfAborted());
    }
}

export async function checkDocker(run = docker) {
    try { await run(['info', '--format', '{{.ServerVersion}}']); }
    catch (cause) {
        throw new Error('Docker is unavailable. Install/start Docker Engine or Docker Desktop and run `docker info`. In a Dev Container, enable the docker-outside-of-docker feature and rebuild; verify socket permissions. Do not start a nested daemon. See docs/src/development-caddy.md.', { cause });
    }
}

export function validateName(name) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(name || '')) throw new Error('Use an instance name of 1–32 lowercase letters, digits or hyphens, starting with a letter.');
    return name;
}

export function defaultCaddyfile(name) {
    validateName(name);
    return `{
    admin 0.0.0.0:2019
    auto_https off
}

:80 {
    log {
        output file /data/dev-caddy/logs/access.log
        format json
    }
    respond /health "ok" 200
    respond /error "deliberate test error" 503
    respond "Caddy UI test instance: ${name}" 200
}
`;
}

export async function withLock(directory, action) {
    await mkdir(directory, { recursive: true });
    const lock = resolve(directory, 'lifecycle.lock');
    try { await mkdir(lock); }
    catch (cause) { throw new Error(`Another lifecycle command is running. If it crashed, remove ${lock} after verifying no command is active.`, { cause }); }
    try { return await action(); }
    finally { await rm(lock, { recursive: true }); }
}

export async function namespace(directory = STATE) {
    await mkdir(directory, { recursive: true });
    const file = resolve(directory, 'namespace');
    let value;
    try { value = (await readFile(file, 'utf8')).trim(); }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
        value = randomBytes(8).toString('hex');
        await writeFile(file, value, { flag: 'wx' });
    }
    if (!/^[a-f0-9]{16}$/.test(value)) throw new Error('Invalid development namespace; refusing Docker operations.');
    return value;
}

export class Harness {
    constructor(project, run = docker) {
        if (!/^[a-f0-9]{16}$/.test(project)) throw new Error('Invalid project namespace');
        this.project = project;
        this.run = run;
    }

    resource(name) { return `caddy-ui-dev-${this.project}-${validateName(name)}`; }
    labels(name) { return [`${LABEL}=true`, `${LABEL}.project=${this.project}`, `${LABEL}.instance=${validateName(name)}`]; }
    filters() { return ['--filter', `label=${LABEL}=true`, '--filter', `label=${LABEL}.project=${this.project}`]; }

    async inspect(kind, id) {
        // List first: absence is normal; daemon/permission errors must not look like absence.
        const ids = (await this.run(kind === 'container'
            ? ['ps', '-aq', '--no-trunc', '--filter', `name=^/${id}$`]
            : ['volume', 'ls', '-q', '--filter', `name=^${id}$`])).split('\n').filter(Boolean);
        if (!ids.length) return null;
        const [detail] = JSON.parse(await this.run([kind, 'inspect', id]));
        this.assertOwned(kind, detail);
        return detail;
    }

    assertOwned(kind, detail) {
        const labels = kind === 'container' ? detail.Config?.Labels : detail.Labels;
        const name = labels?.[`${LABEL}.instance`];
        if (labels?.[LABEL] !== 'true' || labels?.[`${LABEL}.project`] !== this.project ||
            !name || (kind === 'container' ? detail.Name?.replace(/^\//, '') : detail.Name) !== this.resource(name)) {
            throw new Error('Resource ownership mismatch; refusing to modify it.');
        }
        return name;
    }

    async network() {
        // Docker-outside-of-Docker: reuse the current Dev Container's network,
        // without connecting/disconnecting or changing that container.
        if (!process.env.REMOTE_CONTAINERS && !process.env.CODESPACES && !process.env.DEV_CADDY_NETWORK) return null;
        if (process.env.DEV_CADDY_NETWORK) return process.env.DEV_CADDY_NETWORK;
        try {
            const [self] = JSON.parse(await this.run(['container', 'inspect', hostname()]));
            const networks = Object.keys(self.NetworkSettings?.Networks || {}).filter(n => !['host', 'none'].includes(n));
            if (networks.length === 1) return networks[0];
        } catch { /* Diagnostic below includes the manual override. */ }
        throw new Error('Cannot determine the Dev Container network. Set DEV_CADDY_NETWORK to its Docker network name (docker inspect <dev-container>). Docker Desktop container IPs are not reachable from the host.');
    }

    async create(name, { caddyfile = defaultCaddyfile(name), publishHttps = false } = {}) {
        const resource = this.resource(name);
        const existing = await this.inspect('container', resource);
        if (existing) {
            if (!existing.State.Running) await this.run(['start', existing.Id]);
            return this.describe(name);
        }
        if (!await this.inspect('volume', resource)) {
            await this.run(['volume', 'create', ...this.labels(name).flatMap(l => ['--label', l]), resource]);
        }
        const network = await this.network();
        await this.run(['create', '--name', resource,
            ...this.labels(name).flatMap(l => ['--label', l]),
            '--mount', `type=volume,src=${resource},dst=/data/dev-caddy`,
            '--publish', '127.0.0.1::80', '--publish', '127.0.0.1::2019',
            ...(publishHttps ? ['--publish', '127.0.0.1::443'] : []),
            ...(network ? ['--network', network] : []),
            '--env', 'XDG_DATA_HOME=/data/dev-caddy/data', '--env', 'XDG_CONFIG_HOME=/data/dev-caddy/config',
            '--env', `DEV_CADDYFILE=${caddyfile}`,
            '--env', 'CADDY_CONFIG_PATH=/data/dev-caddy/Caddyfile', '--env', 'CADDY_LOG_PATH=/data/dev-caddy/logs/access.log',
            '--entrypoint', 'sh', IMAGE, '-c',
            'mkdir -p /data/dev-caddy/logs; if [ ! -f /data/dev-caddy/Caddyfile ]; then printf "%s" "$DEV_CADDYFILE" > /data/dev-caddy/Caddyfile; fi; exec caddy run --config /data/dev-caddy/Caddyfile --adapter caddyfile']);
        await this.run(['start', resource]);
        return this.describe(name);
    }

    async describe(name) {
        const detail = await this.inspect('container', this.resource(name));
        if (!detail) throw new Error(`No container for ${name}`);
        const network = await this.network();
        const port = key => detail.NetworkSettings.Ports?.[key]?.[0]?.HostPort;
        const address = network ? detail.NetworkSettings.Networks?.[network]?.IPAddress : '127.0.0.1';
        if (!address) throw new Error('Container has no reachable address; check its network and running state.');
        return {
            name, running: detail.State.Running,
            httpUrl: `http://${address}:${network ? 80 : port('80/tcp')}`,
            ...(port('443/tcp') ? { httpsUrl: `https://${address}:${network ? 443 : port('443/tcp')}` } : {}),
            instance: { name: `Dev ${name}`, adminUrl: `http://${address}:${network ? 2019 : port('2019/tcp')}`,
                containerName: this.resource(name), configPath: '/data/dev-caddy/Caddyfile',
                logPath: '/data/dev-caddy/logs/access.log', dataPath: '/data/dev-caddy/data/caddy', serverName: 'srv0' },
        };
    }

    async names(kind = 'container') {
        const output = await this.run(kind === 'container'
            ? ['ps', '-aq', '--no-trunc', ...this.filters()]
            : ['volume', 'ls', '-q', ...this.filters()]);
        const names = [];
        for (const id of output.split('\n').filter(Boolean)) {
            const [detail] = JSON.parse(await this.run([kind, 'inspect', id]));
            names.push(this.assertOwned(kind, detail));
        }
        return names;
    }

    // Replaces an instance's Caddyfile in place, as an external editor would.
    writeConfig(name, content) {
        return this.run(['exec', this.resource(name), 'sh', '-c', 'printf "%s" "$1" > /data/dev-caddy/Caddyfile', 'sh', content]);
    }

    readConfig(name) {
        return this.run(['exec', this.resource(name), 'cat', '/data/dev-caddy/Caddyfile'], { trim: false });
    }

    async stop(name) {
        const detail = await this.inspect('container', this.resource(name));
        if (detail?.State.Running) await this.run(['stop', detail.Id]);
    }

    async remove(name, purge = false) {
        const detail = await this.inspect('container', this.resource(name));
        const volume = purge ? await this.inspect('volume', this.resource(name)) : null;
        if (detail) await this.run(['rm', '-f', detail.Id]);
        if (volume) await this.run(['volume', 'rm', volume.Name]);
    }

    async removeAll({ confirmed = false, purge = false } = {}) {
        if (!confirmed) throw new Error('Bulk removal requires explicit confirmation (--yes).');
        // Validate the entire set before the first removal, including orphan volumes.
        const names = new Set([...(await this.names()), ...(purge ? await this.names('volume') : [])]);
        for (const name of names) await this.remove(name, purge);
    }
}

// What a development backend gets instead of production values: its own state
// files under `directory`, one instance and no calls home.
function ownedEnvironment(directory, instance) {
    const state = { AUTH_PATH: 'auth.json', INSTANCES_PATH: 'instances.json', SETTINGS_PATH: 'settings.json',
        SERVER_NAMES_PATH: 'server-names.json', UPTIME_HISTORY_PATH: 'uptime-history.json',
        NOTIFICATIONS_CONFIG_PATH: 'notifications.json', ROUTE_NOTES_PATH: 'route-notes.json',
        HISTORY_PATH: 'history', AUDIT_LOG_PATH: 'audit-log.json', MAINTENANCE_PATH: 'maintenance.json', WWW_PATH: 'www', THEMES_PATH: 'themes' };
    return {
        NODE_ENV: 'development', CADDY_UI_UPDATE_CHECK: 'false', CADDY_UI_TRUSTED_PROXIES: '',
        CADDY_ADMIN_URL: instance.adminUrl, CADDY_CONTAINER_NAME: instance.containerName,
        CADDY_CONFIG_PATH: instance.configPath, CADDY_LOG_PATH: instance.logPath, CADDY_DATA_PATH: instance.dataPath,
        ...Object.fromEntries(Object.entries(state).map(([key, file]) => [key, resolve(directory, 'backend', file)])),
    };
}

// For running the app by hand: settings from the developer's shell still apply.
export function backendEnvironment(directory, instance) {
    return { ...process.env, PORT: '3001', APP_VERSION: 'dev-caddy', ...ownedEnvironment(directory, instance) };
}

const APP_SETTING = /^(CADDY|UPTIME_HISTORY_|MAX_HISTORY)|^(JWT_SECRET|LOG_LEVEL|APP_VERSION|PORT)$/;

// For tests and captures: whatever the shell sets for the app is left out, so a
// run depends only on its own overrides. Listens on a port the OS picks.
export function isolatedBackendEnvironment(directory, instance = {}, overrides = {}) {
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !APP_SETTING.test(key)));
    return { ...inherited, PORT: '0', APP_VERSION: 'dev-caddy', ...ownedEnvironment(directory, instance), ...overrides };
}

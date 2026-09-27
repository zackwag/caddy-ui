import { spawn } from 'child_process';
import logger from './logger.js';

export const CADDY_CONTAINER = process.env.CADDY_CONTAINER_NAME || 'caddy';

const _envCaches = new Map();
const ENV_CACHE_TTL = 5 * 60 * 1000;

function assertSafeCommand(cmd) {
    if (typeof cmd !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(cmd)) {
        throw new Error('Invalid command');
    }
}

function assertSafeArgs(args) {
    if (!Array.isArray(args)) {
        throw new Error('Arguments must be an array');
    }
    for (const arg of args) {
        if (typeof arg !== 'string' || arg.includes('\0')) {
            throw new Error('Invalid command argument');
        }
    }
}

function assertSafePathArg(pathArg) {
    if (
        typeof pathArg !== 'string' ||
        pathArg.length === 0 ||
        pathArg.includes('\0') ||
        pathArg.includes('..') ||
        /[\r\n\t]/.test(pathArg)
    ) {
        throw new Error('Invalid path argument');
    }
}

export async function getCaddyEnv(containerName) {
    if (!containerName) return { ...process.env };
    const container = containerName;
    const cached = _envCaches.get(container);
    if (cached && Date.now() - cached.ts < ENV_CACHE_TTL) return cached.env;
    try {
        const { stdout } = await dockerExec(['env'], undefined, container);
        const env = {};
        for (const line of stdout.split('\n')) {
            const eq = line.indexOf('=');
            if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
        }
        _envCaches.set(container, { env, ts: Date.now() });
        logger.debug('Cached Caddy container env vars', { container, count: Object.keys(env).length });
        return env;
    } catch {
        return {};
    }
}

// Substitutes Caddy-style {$VAR} placeholders with values from the container's environment
export function resolveEnvVars(str, env) {
    return str.replace(/\{\$([A-Z_][A-Z0-9_]*)\}/g, (_, name) => env[name] || '');
}

export function dockerExec(args, input, containerName) {
    const container = containerName || CADDY_CONTAINER;
    assertSafeCommand(container);
    assertSafeArgs(args);
    if (args.length === 0) {
        throw new Error('Missing docker exec command');
    }
    assertSafeCommand(args[0]);

    const pathArgIndexesByCmd = {
        cat: [1],
        tee: [1],
        ls: [2],
        rm: [2],
        test: [2],
    };
    const pathIndexes = pathArgIndexesByCmd[args[0]] || [];
    for (const idx of pathIndexes) {
        if (idx < args.length) assertSafePathArg(args[idx]);
    }

    return execAndCollect('docker', ['exec', '-i', container, ...args], input);
}

// Runs a command directly on the host (local filesystem mode, no Docker), collecting
// output the same way dockerExec does so both branches behave identically on failure.
export function execLocal(cmd, args, input) {
    return execAndCollect(cmd, args, input);
}

// Picks Docker-exec vs local-spawn based on whether an instance has a container name,
// mirroring the same dispatch containerFs.js already uses for file I/O.
export function execInInstance(containerName, cmd, args, input) {
    if (containerName) return dockerExec([cmd, ...args], input, containerName);
    return execLocal(cmd, args, input);
}

// Returns the raw spawned process (for streaming use cases like `tail -f`) rather
// than collecting output into a Promise.
export function spawnInInstance(containerName, cmd, args) {
    assertSafeCommand(cmd);
    assertSafeArgs(args);
    if (containerName) return spawn('docker', ['exec', containerName, cmd, ...args], { shell: false });
    return spawn(cmd, args, { shell: false });
}

function execAndCollect(cmd, args, input) {
    return new Promise((resolve, reject) => {
        assertSafeCommand(cmd);
        assertSafeArgs(args);
        const proc = spawn(cmd, args, { shell: false });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('close', code => {
            if (code === 0) resolve({ stdout, stderr });
            else reject(Object.assign(new Error(stderr.trim() || stdout.trim()), { stdout, stderr, code }));
        });
        proc.on('error', err => {
            reject(Object.assign(err, { stdout, stderr: err.message, code: null }));
        });
        if (input) {
            proc.stdin.write(input);
            proc.stdin.end();
        }
    });
}

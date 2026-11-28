import { spawn } from 'child_process';
import logger from './logger.js';

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

// Rejects when the container's environment can't be read, so {$VAR} site
// addresses never silently resolve to nothing.
export async function getCaddyEnv(containerName) {
    // Local mode: caddy-ui's own environment, the closest available to Caddy's.
    if (!containerName) return { ...process.env };
    const cached = _envCaches.get(containerName);
    if (cached && Date.now() - cached.ts < ENV_CACHE_TTL) return cached.env;
    const { stdout } = await dockerExec(containerName, ['env']);
    const env = {};
    for (const line of stdout.split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
    }
    _envCaches.set(containerName, { env, ts: Date.now() });
    logger.debug('Cached Caddy container env vars', { container: containerName, count: Object.keys(env).length });
    return env;
}

const PATH_COMMANDS = new Set(['cat', 'tee', 'ls', 'rm']);

export function dockerExec(containerName, args, input) {
    assertSafeCommand(containerName);
    assertSafeArgs(args);
    if (args.length === 0) {
        throw new Error('Missing docker exec command');
    }
    assertSafeCommand(args[0]);

    // File commands take their paths after `--`, so a path can't be read as an option.
    if (PATH_COMMANDS.has(args[0])) {
        const separator = args.indexOf('--');
        if (separator === -1 || separator === args.length - 1) {
            throw new Error('Missing path argument');
        }
        args.slice(separator + 1).forEach(assertSafePathArg);
    }

    return execAndCollect('docker', ['exec', '-i', containerName, ...args], input);
}

// Picks Docker-exec vs local-spawn based on whether an instance has a container name,
// mirroring the same dispatch containerFs.js already uses for file I/O.
export function execInInstance(containerName, cmd, args, input) {
    if (containerName) return dockerExec(containerName, [cmd, ...args], input);
    return execAndCollect(cmd, args, input);
}

// Returns the raw spawned process (for streaming use cases like `tail -f`) rather
// than collecting output into a Promise.
export function spawnInInstance(containerName, cmd, args) {
    assertSafeCommand(cmd);
    assertSafeArgs(args);
    if (containerName) return spawn('docker', ['exec', containerName, cmd, ...args], { shell: false });
    return spawn(cmd, args, { shell: false });
}

// The instance's Caddy version, or 'unknown' when its binary can't say, which
// /api/status/process reports as is.
export async function getCaddyVersion(containerName) {
    try {
        const { stdout } = await execInInstance(containerName, 'caddy', ['version']);
        const version = stdout.trim().split(' ')[0] || 'unknown';
        logger.debug(`Caddy version detected`, { version });
        return version;
    } catch (err) {
        logger.warn(`Could not detect Caddy version`, { error: err.message });
        return 'unknown';
    }
}

// Docker couldn't reach the instance's container at all. A command missing
// inside a running container is a different failure.
const CONTAINER_UNREACHABLE = /cannot connect to the docker daemon|is the docker daemon running|no such container|is not running|permission denied while trying to connect|^spawn docker ENOENT$/im;

export function isContainerUnreachable(err) {
    return CONTAINER_UNREACHABLE.test(`${err?.stderr || ''}\n${err?.message || ''}`);
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

import { spawn } from 'child_process';
import logger from './logger.js';

export const CADDY_CONTAINER = process.env.CADDY_CONTAINER_NAME || 'caddy';

const _envCaches = new Map();

export async function getCaddyEnv(containerName) {
    const container = containerName || CADDY_CONTAINER;
    if (_envCaches.has(container)) return _envCaches.get(container);
    try {
        const { stdout } = await dockerExec(['env'], undefined, container);
        const env = {};
        for (const line of stdout.split('\n')) {
            const eq = line.indexOf('=');
            if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
        }
        _envCaches.set(container, env);
        logger.debug('Cached Caddy container env vars', { container, count: Object.keys(env).length });
        return env;
    } catch {
        return {};
    }
}

export function resolveEnvVars(str, env) {
    return str.replace(/\{\$([A-Z_][A-Z0-9_]*)\}/g, (_, name) => env[name] || '');
}

export function dockerExec(args, input, containerName) {
    const container = containerName || CADDY_CONTAINER;
    return new Promise((resolve, reject) => {
        const proc = spawn('docker', ['exec', '-i', container, ...args]);
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

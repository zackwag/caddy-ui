import { spawn } from 'child_process';
import logger from './logger.js';

export const CADDY_CONTAINER = process.env.CADDY_CONTAINER_NAME || 'caddy';

let _envCache = null;

export async function getCaddyEnv() {
    if (_envCache) return _envCache;
    try {
        const { stdout } = await dockerExec(['env']);
        const env = {};
        for (const line of stdout.split('\n')) {
            const eq = line.indexOf('=');
            if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
        }
        _envCache = env;
        logger.debug('Cached Caddy container env vars', { count: Object.keys(env).length });
        return env;
    } catch {
        return {};
    }
}

export function resolveEnvVars(str, env) {
    return str.replace(/\{\$([A-Z_][A-Z0-9_]*)\}/g, (_, name) => env[name] || '');
}

export function dockerExec(args, input) {
    return new Promise((resolve, reject) => {
        const proc = spawn('docker', ['exec', '-i', CADDY_CONTAINER, ...args]);
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

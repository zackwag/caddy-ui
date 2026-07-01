import { spawn } from 'child_process';

export const CADDY_CONTAINER = process.env.CADDY_CONTAINER_NAME || 'caddy';

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

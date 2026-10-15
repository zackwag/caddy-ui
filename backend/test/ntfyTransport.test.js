import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNtfyPolicy } from '../src/ntfyPolicy.js';
import { sendNtfy } from '../src/ntfyTransport.js';

const servers = [];
const directories = [];
const exec = promisify(execFile);
afterEach(async () => {
    vi.restoreAllMocks();
    try {
        await Promise.all(servers.splice(0).map(server => new Promise(resolve => {
            server.closeAllConnections();
            server.close(resolve);
        })));
    } finally {
        await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
    }
});
async function server(handler) {
    const instance = http.createServer(handler);
    servers.push(instance);
    instance.listen(0, '127.0.0.1');
    await once(instance, 'listening');
    const url = `http://ntfy.test:${instance.address().port}/alerts?token=secret`;
    const lookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const resolveDestination = createNtfyPolicy({ env: {
        CADDY_UI_NTFY_ALLOWED_INTERNAL_URLS: JSON.stringify([url]),
        CADDY_UI_NTFY_ALLOWED_INTERNAL_NETWORKS: '["127.0.0.0/8"]',
        CADDY_UI_NTFY_ALLOW_LOOPBACK: 'true',
    }, lookup, log: { warn: vi.fn(), debug: vi.fn() } });
    return { url, lookup, resolveDestination };
}
const notification = { title: 'Alert', message: 'An upstream is down', priority: 'high' };

describe('ntfy pinned HTTP delivery', () => {
    it('delivers the real POST to the checked IP, preserving Host, path, title and priority', async () => {
        const received = [];
        const fixture = await server(async (request, response) => {
            let body = '';
            for await (const chunk of request) body += chunk;
            received.push({ headers: request.headers, method: request.method, url: request.url, body });
            response.end('{}');
        });
        await sendNtfy(fixture.url, notification, fixture);
        expect(received).toEqual([expect.objectContaining({ method: 'POST', url: '/alerts?token=secret', body: notification.message,
            headers: expect.objectContaining({ host: new URL(fixture.url).host, title: 'Alert', priority: 'high' }),
        })]);
        expect(fixture.lookup).toHaveBeenCalledTimes(1);
        // A new delivery revalidates DNS rather than reusing the original connection.
        fixture.lookup.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);
        await expect(sendNtfy(fixture.url, notification, fixture)).rejects.toThrow('outside_internal_policy');
        expect(received).toHaveLength(1);
    });

    it('rejects redirects without sending to the redirected destination', async () => {
        const targetHit = vi.fn((request, response) => response.end());
        const target = await server(targetHit);
        const source = await server((request, response) => {
            response.writeHead(307, { Location: target.url });
            response.end();
        });
        await expect(sendNtfy(source.url, notification, source)).rejects.toThrow('redirects are not permitted');
        expect(targetHit).not.toHaveBeenCalled();
    });

    it('reports non-success responses', async () => {
        const fixture = await server((request, response) => {
            response.writeHead(503);
            response.end('Unavailable');
        });
        await expect(sendNtfy(fixture.url, notification, fixture)).rejects.toThrow('ntfy responded 503: Unavailable');
    });

    it('bounds stalled requests and oversized responses', async () => {
        const stalled = await server(() => {});
        await expect(sendNtfy(stalled.url, notification, { ...stalled, timeoutMs: 30 })).rejects.toThrow('timed out');
        const oversized = await server((request, response) => response.end('x'.repeat(65 * 1024)));
        await expect(sendNtfy(oversized.url, notification, oversized)).rejects.toThrow('size limit');
    });

    it('verifies certificates and hostname identity on a real pinned TLS connection', async () => {
        // Keep keys outside the checkout, in a private directory removed even if the test fails.
        const directory = await mkdtemp(join(tmpdir(), 'caddy-ui-ntfy-tls-'));
        directories.push(directory);
        const certPath = join(directory, 'cert.pem');
        const keyPath = join(directory, 'key.pem');
        try {
            await exec('openssl', [
                'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
                '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=ntfy.test',
                '-addext', 'subjectAltName=DNS:ntfy.test', '-addext', 'basicConstraints=critical,CA:TRUE',
            ], { timeout: 5_000 });
        } catch (error) {
            if (error.code === 'ENOENT') throw new Error('OpenSSL 1.1.1 or newer is required for the ntfy TLS test; install openssl and rerun npm test', { cause: error });
            throw error;
        }
        await chmod(keyPath, 0o600);
        const received = [];
        const instance = https.createServer({ cert: await readFile(certPath), key: await readFile(keyPath) }, (request, response) => {
            received.push({ host: request.headers.host, servername: request.socket.servername });
            response.end('{}');
        });
        servers.push(instance);
        instance.listen(0, '127.0.0.1');
        await once(instance, 'listening');
        const url = `https://ntfy.test:${instance.address().port}/topic`;
        // Extra CAs are read at process startup. Keep trust changes in a child process.
        const script = `
            import { createNtfyPolicy } from ${JSON.stringify(new URL('../src/ntfyPolicy.js', import.meta.url).href)};
            import { sendNtfy } from ${JSON.stringify(new URL('../src/ntfyTransport.js', import.meta.url).href)};
            const url = process.argv[1];
            const resolveDestination = createNtfyPolicy({ env: {
                CADDY_UI_NTFY_ALLOWED_INTERNAL_URLS: JSON.stringify([url]),
                CADDY_UI_NTFY_ALLOWED_INTERNAL_NETWORKS: '["127.0.0.0/8"]',
                CADDY_UI_NTFY_ALLOW_LOOPBACK: 'true',
            }, lookup: async () => [{ address: '127.0.0.1', family: 4 }] });
            try { await sendNtfy(url, { title: 'TLS test', message: 'message' }, { resolveDestination }); }
            catch (error) { console.error(error.code); process.exitCode = 1; }
        `;
        const run = (target, trust) => {
            const env = { ...process.env };
            delete env.NODE_TLS_REJECT_UNAUTHORIZED;
            if (trust) env.NODE_EXTRA_CA_CERTS = certPath;
            else delete env.NODE_EXTRA_CA_CERTS;
            return exec(process.execPath, ['--input-type=module', '-e', script, target], { env, timeout: 3_000 });
        };
        await run(url, true);
        expect(received).toEqual([{ host: new URL(url).host, servername: 'ntfy.test' }]);
        await expect(run(url.replace('ntfy.test', 'other.test'), true)).rejects.toMatchObject({
            stderr: expect.stringContaining('ERR_TLS_CERT_ALTNAME_INVALID'),
        });
        await expect(run(url, false)).rejects.toMatchObject({
            stderr: expect.stringContaining('DEPTH_ZERO_SELF_SIGNED_CERT'),
        });
        expect(received).toHaveLength(1);
    }, 20_000);
});

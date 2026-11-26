import { once } from 'node:events';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake Docker API on a socket of its own
const dir = mkdtempSync(join(tmpdir(), 'caddy-ui-docker-'));
const docker = { requests: [], self: null, containers: null };
const server = createServer((req, res) => {
    docker.requests.push(req.url);
    const body = req.url === '/containers/backend-host/json' ? docker.self : req.url.startsWith('/containers/json') ? docker.containers : null;
    res.statusCode = body ? 200 : 500;
    res.end(body ? JSON.stringify(body) : 'daemon error');
});
server.listen(join(dir, 'docker.sock'));
await once(server, 'listening');

vi.stubEnv('DOCKER_SOCKET', join(dir, 'docker.sock'));
vi.stubEnv('HOSTNAME', 'backend-host');
vi.stubEnv('CADDY_UI_URL', '');
vi.stubEnv('PORT', '');
const { discoverCaddyContainers, getBackendUrl } = await import('../src/dockerDiscovery.js');
const { default: logger } = await import('../src/logger.js');

afterAll(async () => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
});

beforeEach(() => {
    docker.requests = [];
});

describe('Docker discovery', () => {
    it('reports a Docker failure instead of finding no containers', async () => {
        docker.containers = null;
        await expect(discoverCaddyContainers()).rejects.toThrow('Docker API 500');
    });

    it('finds no containers when there is no Docker socket', async () => {
        vi.resetModules();
        vi.stubEnv('DOCKER_SOCKET', join(dir, 'missing.sock'));
        const { discoverCaddyContainers: discover } = await import('../src/dockerDiscovery.js');
        expect(await discover()).toEqual([]);
        vi.stubEnv('DOCKER_SOCKET', join(dir, 'docker.sock'));
    });

    // Root bypasses socket permissions
    it.skipIf(process.getuid?.() === 0)('reports a socket it may not use as a failure', async () => {
        const denied = createServer(() => {});
        denied.listen(join(dir, 'denied.sock'));
        await once(denied, 'listening');
        chmodSync(join(dir, 'denied.sock'), 0o000);
        vi.resetModules();
        vi.stubEnv('DOCKER_SOCKET', join(dir, 'denied.sock'));
        const { discoverCaddyContainers: discover } = await import('../src/dockerDiscovery.js');
        await expect(discover()).rejects.toMatchObject({ code: 'EACCES' });
        vi.stubEnv('DOCKER_SOCKET', join(dir, 'docker.sock'));
        denied.close();
    });

    it('finds the backend container itself, logging a failed lookup once and keeping a found name', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        docker.self = null;
        expect(await getBackendUrl()).toBeNull();
        expect(await getBackendUrl()).toBeNull();
        expect(warn.mock.calls.filter(([message]) => message.includes('backend container name'))).toHaveLength(1);

        docker.self = { Name: '/caddy-ui-backend' };
        expect(await getBackendUrl()).toBe('caddy-ui-backend:3001');
        const lookups = docker.requests.length;
        expect(await getBackendUrl()).toBe('caddy-ui-backend:3001');
        expect(docker.requests).toHaveLength(lookups);
        warn.mockRestore();
    });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { afterEach, expect, it, vi } from 'vitest';

const servers = [];
let directory;
let stopMonitor;
afterEach(async () => {
    stopMonitor?.({ enabled: false });
    stopMonitor = null;
    await Promise.all(servers.splice(0).map(server => new Promise(resolve => {
        server.closeAllConnections();
        server.close(resolve);
    })));
    if (directory) await rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});
async function listen(handler) {
    const server = http.createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
}

it('requires the UI-selected URL as well as operator permission on the actual notification API', async () => {
    vi.resetModules();
    directory = await mkdtemp(join(tmpdir(), 'caddy-ui-ntfy-'));
    vi.stubEnv('NOTIFICATIONS_CONFIG_PATH', join(directory, 'notifications.json'));
    const delivered = [];
    const endpoint = await listen(async (request, response) => {
        let body = '';
        for await (const chunk of request) body += chunk;
        delivered.push({ path: request.url, body });
        response.end('{}');
    });
    const topic = `${endpoint}/approved`;
    vi.stubEnv('CADDY_UI_NTFY_ALLOWED_INTERNAL_URLS', JSON.stringify([topic]));
    vi.stubEnv('CADDY_UI_NTFY_ALLOWED_INTERNAL_NETWORKS', '["127.0.0.0/8"]');
    vi.stubEnv('CADDY_UI_NTFY_ALLOW_LOOPBACK', 'true');
    vi.stubEnv('CADDY_UI_NTFY_ALLOW_LINK_LOCAL', 'false');
    const { default: router } = await import('../src/routes/notifications.js');
    const { updateMonitorConfig } = await import('../src/notifications.js');
    const { diagnosticMiddleware } = await import('../src/errorReporting.js');
    stopMonitor = updateMonitorConfig;
    const app = express();
    app.use(express.json());
    app.use(diagnosticMiddleware);
    app.use('/api/notifications', router);
    const api = `${await listen(app)}/api/notifications`;
    const call = (path, body) => fetch(api + path, body ? {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : { method: 'POST' });
    expect((await call('/test')).status).toBe(400);
    expect(delivered).toEqual([]); // An env permission alone does not activate notifications.
    const settings = {
        enabled: true, provider: 'ntfy', ntfy: { url: topic },
        triggers: { upstreamOffline: false, upstreamOnline: false, certExpiring: false, updateAvailable: false },
    };
    expect((await call('/config', settings)).status).toBe(200);
    expect((await call('/test')).status).toBe(200);
    expect(delivered).toEqual([{ path: '/approved', body: 'Notifications are working correctly.' }]);

    // PUT data cannot grant a new URL permission, even if named like the env setting.
    const unapproved = `${endpoint}/other-topic`;
    await call('/config', { ...settings, ntfy: { url: unapproved },
        CADDY_UI_NTFY_ALLOWED_INTERNAL_URLS: [unapproved],
        CADDY_UI_NTFY_ALLOWED_INTERNAL_NETWORKS: ['0.0.0.0/0'],
    });
    const denied = await call('/test');
    expect(denied.status).toBe(403);
    const error = await denied.json();
    expect(error).toMatchObject({ code: 'NTFY_DESTINATION_BLOCKED', requestId: expect.any(String) });
    expect(error.requestId).toBe(denied.headers.get('X-Request-ID'));
    expect(JSON.stringify(error)).not.toMatch(/internal_url_not_approved|127\.0\.0\.1|approved|other-topic/);
    expect(delivered).toHaveLength(1);
    await call('/config', settings);
    expect((await call('/test')).status).toBe(200);
    expect(delivered).toHaveLength(2);
    for (const [provider, options] of [
        ['discord', { discord: { webhookUrl: topic } }],
        ['slack', { slack: { webhookUrl: topic } }],
        ['custom', { custom: { url: topic } }],
    ]) {
        await call('/config', { ...settings, provider, ...options });
        const blocked = await call('/test');
        expect(blocked.status).toBe(403);
        expect(await blocked.json()).toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
    }
    expect(delivered).toHaveLength(2);
});

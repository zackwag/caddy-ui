import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/AppError.js';
import { diagnosticMiddleware } from '../src/errorReporting.js';

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock('../src/notifications.js', () => ({ sendNotification, updateMonitorConfig: vi.fn() }));

let server;
let testUrl;
let configDir;

beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'caddy-ui-notifications-'));
    process.env.NOTIFICATIONS_CONFIG_PATH = join(configDir, 'notifications.json');
    await writeFile(process.env.NOTIFICATIONS_CONFIG_PATH, JSON.stringify({ enabled: true, provider: 'ntfy', ntfy: { url: 'http://ntfy/alerts' } }));
    const { default: notificationsRouter } = await import('../src/routes/notifications.js');

    const app = express();
    app.use(diagnosticMiddleware);
    app.use('/api/notifications', notificationsRouter);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    testUrl = `http://127.0.0.1:${server.address().port}/api/notifications/test`;
});

afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(configDir, { recursive: true, force: true });
    delete process.env.NOTIFICATIONS_CONFIG_PATH;
});

beforeEach(() => {
    sendNotification.mockReset().mockResolvedValue(undefined);
});

async function sendTest() {
    const response = await fetch(testUrl, { method: 'POST' });
    return { status: response.status, body: await response.json() };
}

describe('POST /api/notifications/test', () => {
    it('sends a test notification', async () => {
        const { status, body } = await sendTest();
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
    });

    it('reports a failed send without the destination response', async () => {
        sendNotification.mockRejectedValue(new Error('ntfy responded 500: secret internal page'));
        const { status, body } = await sendTest();
        expect(status).toBe(502);
        expect(body.code).toBe('NOTIFICATION_SEND_FAILED');
        expect(JSON.stringify(body)).not.toContain('secret internal page');
    });

    it('reports blocked destinations with their own code', async () => {
        sendNotification.mockRejectedValue(new AppError('WEBHOOK_DESTINATION_BLOCKED', { message: 'loopback: 127.0.0.1' }));
        const { status, body } = await sendTest();
        expect(status).toBe(403);
        expect(body.code).toBe('WEBHOOK_DESTINATION_BLOCKED');
        expect(JSON.stringify(body)).not.toContain('127.0.0.1');
    });
});

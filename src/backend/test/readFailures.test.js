import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { serve } from './fixtures/server.mjs';

const { caddyGet, instances } = vi.hoisted(() => ({ caddyGet: vi.fn(), instances: [] }));

vi.mock('../src/caddy.js', async importOriginal => ({ ...await importOriginal(), caddyGet }));
vi.mock('../src/instances.js', async importOriginal => ({ ...await importOriginal(), getInstances: () => instances }));
vi.mock('../src/caddyfileTitles.js', async importOriginal => ({ ...await importOriginal(), caddyfileTitlesEnabled: () => false }));

const root = await mkdtemp(join(tmpdir(), 'caddy-ui-read-failures-'));
const historyPath = join(root, 'history');
process.env.ROUTE_NOTES_PATH = join(root, 'route-notes.json');
process.env.HISTORY_PATH = historyPath;
process.env.NOTIFICATIONS_CONFIG_PATH = join(root, 'notifications.json');
const { default: logger } = await import('../src/logger.js');
const { default: caddyfileRouter } = await import('../src/routes/caddyfile.js');
const { initNotifications, runReminders } = await import('../src/notifications.js');
const { saveNotificationConfig } = await import('../src/notificationConfig.js');

const isRoot = process.getuid?.() === 0;
let server;
let baseUrl;

beforeAll(async () => {
    server = await serve(app => {
        app.use('/api', (req, res, next) => {
            req.instance = { id: 'default', adminUrl: 'http://caddy:2019', containerName: '', configPath: join(root, 'Caddyfile') };
            next();
        });
        app.use('/api/caddyfile', caddyfileRouter);
    });
    baseUrl = server.url + '/api';
});

afterAll(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
    caddyGet.mockReset();
    instances.splice(0, instances.length, { id: 'alpha', adminUrl: 'http://alpha:2019' }, { id: 'beta', adminUrl: 'http://beta:2019' });
});

afterEach(() => vi.restoreAllMocks());

const request = async (method, path, body) => {
    const res = await fetch(baseUrl + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
};

describe('Caddyfile history list', () => {
    afterEach(() => chmod(historyPath, 0o755).catch(() => { }));

    it('lists snapshots', async () => {
        await mkdir(historyPath, { recursive: true });
        await writeFile(join(historyPath, 'Caddyfile-2026-10-18T12-00-00'), 'a {\n}\n');
        const { status, body } = await request('GET', '/caddyfile/history');
        expect(status).toBe(200);
        expect(body).toEqual([{ filename: 'Caddyfile-2026-10-18T12-00-00', timestamp: '2026-10-18T12:00:00Z',
            actor: null, parent: null, action: null, outcome: 'unknown' }]);
    });

    it.skipIf(isRoot)('reports an unreadable history directory instead of an empty list', async () => {
        await mkdir(historyPath, { recursive: true });
        await chmod(historyPath, 0o000);
        expect(await request('GET', '/caddyfile/history')).toMatchObject({
            status: 500, body: { code: 'CADDYFILE_HISTORY_READ_FAILED' },
        });
    });
});

describe('Caddyfile body', () => {
    it.each([['PUT', '/caddyfile'], ['POST', '/caddyfile/validations']])('%s %s rejects a body that is not text', async (method, path) => {
        expect(await request(method, path, ['a {', '}'])).toMatchObject({
            status: 400, body: { code: 'VALIDATION_FAILED' },
        });
    });
});

describe('certificate expiry checks', () => {
    const inst = (dataPath) => ({ id: 'alpha', name: 'Alpha', containerName: '', dataPath, adminUrl: 'http://alpha:2019' });
    const triggers = { upstreamOffline: false, upstreamOnline: false, certExpiring: true, updateAvailable: false, apiTokenExpiring: false };

    // Each test runs one reminder round over just its own instance.
    async function checkCerts(instance) {
        instances.splice(0, instances.length, instance);
        await runReminders();
    }

    beforeAll(async () => {
        await initNotifications();
        instances.splice(0, instances.length);
        await saveNotificationConfig({ enabled: true, provider: 'ntfy', ntfy: { url: 'http://ntfy/alerts' }, triggers });
        await runReminders();
    });

    afterAll(() => saveNotificationConfig({ enabled: false }));

    it.skipIf(isRoot)('logs unreadable certificate storage once per outage', async () => {
        const warn = vi.spyOn(logger, 'warn');
        const info = vi.spyOn(logger, 'info');
        const certsPath = join(root, 'locked-data', 'certificates');
        const locked = inst(join(root, 'locked-data'));
        await mkdir(certsPath, { recursive: true });
        await chmod(certsPath, 0o000);

        await checkCerts(locked);
        await checkCerts(locked);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/Certificate expiry checks skipped/);

        await chmod(certsPath, 0o755);
        await checkCerts(locked);
        expect(info).toHaveBeenCalledWith('Certificate expiry checks resumed', { instance: 'Alpha' });
    });

    it("stays quiet when Caddy hasn't created its data directory (HTTP-only setups)", async () => {
        const warn = vi.spyOn(logger, 'warn');
        await checkCerts({ ...inst(join(root, 'never-created')), id: 'http-only' });
        expect(warn).not.toHaveBeenCalled();
    });

    it("stays quiet before Caddy has stored a certificate", async () => {
        const warn = vi.spyOn(logger, 'warn');
        await mkdir(join(root, 'fresh-data'), { recursive: true });
        await checkCerts({ ...inst(join(root, 'fresh-data')), id: 'fresh' });
        expect(warn).not.toHaveBeenCalled();
    });
});

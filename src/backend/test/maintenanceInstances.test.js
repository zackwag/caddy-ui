import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { files, instances } = vi.hoisted(() => ({ files: new Map(), instances: [] }));

vi.mock('../src/containerFs.js', () => ({
    readContainerFile: vi.fn(async (container, path) => {
        if (!files.has(path)) throw new Error('ENOENT');
        return files.get(path);
    }),
}));
vi.mock('../src/docker.js', async importOriginal => ({
    ...await importOriginal(),
    getCaddyEnv: vi.fn(async () => ({})),
}));
vi.mock('../src/routes/caddyfile.js', () => ({
    saveRouteEdit: vi.fn(async (instance, content) => { files.set(instance.configPath, content); }),
}));
vi.mock('../src/instances.js', () => ({ getInstances: () => instances }));

// Both paths are read at import time
const dir = mkdtempSync(join(tmpdir(), 'caddy-ui-maintenance-'));
process.env.MAINTENANCE_PATH = join(dir, 'maintenance.json');
process.env.WWW_PATH = join(dir, 'www');
const maintenance = await import('../src/maintenance.js');
const { default: routesRouter } = await import('../src/routes/routes.js');

const instance = id => ({ id, name: id, adminUrl: `http://${id}:2019`, configPath: `/etc/${id}/Caddyfile`, containerName: '' });
const alpha = instance('alpha');
const beta = instance('beta');
const site = (upstream) => `app.example.com {\n    reverse_proxy ${upstream}\n}\n`;
const savedFile = () => JSON.parse(readFileSync(process.env.MAINTENANCE_PATH, 'utf8'));

async function resetState(contents) {
    if (contents === undefined) writeFileSync(process.env.MAINTENANCE_PATH, '{}');
    else writeFileSync(process.env.MAINTENANCE_PATH, JSON.stringify(contents));
    await maintenance.loadMaintenance();
}

beforeEach(async () => {
    files.clear();
    files.set(alpha.configPath, site('alpha-app:3000'));
    files.set(beta.configPath, site('beta-app:3000'));
    instances.splice(0, instances.length, alpha, beta);
    await resetState();
});

describe('maintenance state store', () => {
    it('keeps the same hostname separate on each instance', async () => {
        await maintenance.setMaintenance('alpha', 'app.example.com', 'alpha block');
        expect(maintenance.isInMaintenance('beta', 'app.example.com')).toBe(false);
        expect(await maintenance.clearMaintenance('beta', 'app.example.com')).toBeUndefined();
        expect(maintenance.getMaintenanceState('alpha')['app.example.com'].originalContent).toBe('alpha block');
        expect(maintenance.getMaintenanceState('beta')).toEqual({});
    });

    it('reloads persisted per-instance state', async () => {
        await maintenance.setMaintenance('alpha', 'app.example.com', 'alpha block');
        await maintenance.loadMaintenance();
        expect(savedFile().version).toBe(2);
        expect(maintenance.isInMaintenance('alpha', 'app.example.com')).toBe(true);
    });

    it('loads domain-only state as unassigned instead of giving it to any instance', async () => {
        await resetState({ 'app.example.com': { originalContent: 'legacy block', enabledAt: '2026-01-01T00:00:00.000Z' } });
        expect(maintenance.hasUnassignedMaintenance()).toBe(true);
        expect(maintenance.getMaintenanceState('alpha')).toEqual({});
        expect(maintenance.getMaintenanceState('beta')).toEqual({});
    });

    it('assigns saved state to the one instance serving the maintenance page', async () => {
        await resetState({ 'app.example.com': { originalContent: 'legacy block', enabledAt: '2026-01-01T00:00:00.000Z' } });
        await maintenance.claimUnassignedMaintenance([alpha, beta], async inst => inst.id === 'beta');
        expect(maintenance.getMaintenanceState('beta')['app.example.com']).toEqual({
            originalContent: 'legacy block', enabledAt: '2026-01-01T00:00:00.000Z',
        });
        expect(maintenance.hasUnassignedMaintenance()).toBe(false);
        expect(savedFile().unassigned).toEqual([]);
    });

    it.each([
        ['several instances serve it', async () => true],
        ['no instance serves it', async () => false],
        ['an instance cannot be read', async inst => (inst.id === 'alpha' ? null : true)],
    ])('keeps saved state unassigned when %s', async (_, serves) => {
        await resetState({ 'app.example.com': { originalContent: 'legacy block' } });
        await maintenance.claimUnassignedMaintenance([alpha, beta], serves);
        expect(maintenance.hasUnassignedMaintenance()).toBe(true);
        expect(maintenance.getMaintenanceState('alpha')).toEqual({});
        expect(maintenance.getMaintenanceState('beta')).toEqual({});
    });

    it("unassigns a removed instance's state so a reused id can't restore it", async () => {
        await maintenance.setMaintenance('beta', 'app.example.com', 'beta block');
        await maintenance.releaseInstanceMaintenance('beta');
        expect(maintenance.isInMaintenance('beta', 'app.example.com')).toBe(false);
        expect(savedFile().unassigned).toMatchObject([{ domain: 'app.example.com', originalContent: 'beta block', instanceId: 'beta' }]);
    });
});

describe('maintenance routes across instances', () => {
    let server;
    let baseUrl;

    beforeAll(async () => {
        const app = express();
        app.use('/api', (req, res, next) => {
            req.instance = instances.find(i => i.id === req.headers['x-instance-id']);
            next();
        });
        app.use('/api/routes', routesRouter);
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        baseUrl = `http://127.0.0.1:${server.address().port}/api/routes`;
    });

    afterAll(() => new Promise(resolve => server.close(resolve)));

    const call = (method, path, instanceId) => fetch(baseUrl + path, { method, headers: { 'X-Instance-Id': instanceId } });
    const toggle = (method, instanceId) => call(method, '/caddyfile/app.example.com/maintenance', instanceId);

    it("disabling on one instance can't restore another instance's saved block", async () => {
        expect((await toggle('POST', 'alpha')).status).toBe(200);
        expect(files.get(alpha.configPath)).toContain('CADDY_UI_MAINTENANCE');

        expect((await toggle('DELETE', 'beta')).status).toBe(404);
        expect(files.get(beta.configPath)).toBe(site('beta-app:3000'));
        expect(await (await call('GET', '/maintenance', 'beta')).json()).toEqual({});

        expect((await toggle('DELETE', 'alpha')).status).toBe(200);
        expect(files.get(alpha.configPath)).toContain('reverse_proxy alpha-app:3000');
        expect(files.get(alpha.configPath)).not.toContain('CADDY_UI_MAINTENANCE');
    });

    it('enables maintenance for the same hostname on both instances independently', async () => {
        expect((await toggle('POST', 'alpha')).status).toBe(200);
        expect((await toggle('POST', 'beta')).status).toBe(200);
        expect((await toggle('DELETE', 'beta')).status).toBe(200);
        expect(files.get(beta.configPath)).toContain('reverse_proxy beta-app:3000');
        expect(files.get(alpha.configPath)).toContain('CADDY_UI_MAINTENANCE');
    });

    it('lets the instance serving the page disable maintenance saved before the upgrade', async () => {
        expect((await toggle('POST', 'alpha')).status).toBe(200);
        const { originalContent, enabledAt } = maintenance.getMaintenanceState('alpha')['app.example.com'];
        await resetState({ 'app.example.com': { originalContent, enabledAt } });

        expect(await (await call('GET', '/maintenance', 'beta')).json()).toEqual({});
        expect(Object.keys(await (await call('GET', '/maintenance', 'alpha')).json())).toEqual(['app.example.com']);
        expect((await toggle('DELETE', 'alpha')).status).toBe(200);
        expect(files.get(alpha.configPath)).toContain('reverse_proxy alpha-app:3000');
    });

    it('refuses to save the maintenance page as the original block', async () => {
        expect((await toggle('POST', 'alpha')).status).toBe(200);
        const served = files.get(alpha.configPath);
        await resetState({ instances: {}, unassigned: [], version: 2 });

        expect((await toggle('POST', 'alpha')).status).toBe(409);
        expect(files.get(alpha.configPath)).toBe(served);
        expect(maintenance.getMaintenanceState('alpha')).toEqual({});
    });
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { serve } from './fixtures/server.mjs';

const { files, instances } = vi.hoisted(() => ({ files: new Map(), instances: [] }));

vi.mock('../src/containerFs.js', () => ({
    readContainerFile: vi.fn(async (container, path) => {
        if (!files.has(path)) {
            throw new Error('ENOENT');
        }
        return files.get(path);
    }),
}));
vi.mock('../src/docker.js', async importOriginal => ({
    ...await importOriginal(),
    getCaddyEnv: vi.fn(async () => ({})),
}));
vi.mock('../src/caddyfileChange.js', async importOriginal => ({
    ...await importOriginal(),
    saveCaddyfileChange: vi.fn(async (instance, change, { onApplied } = {}) => {
        const content = typeof change === 'function' ? await change(files.get(instance.configPath)) : change;
        files.set(instance.configPath, content);
        await onApplied?.();
        return { applied: true };
    }),
    changeResultFields: () => ({}),
}));
vi.mock('../src/instances.js', async importOriginal => ({ ...await importOriginal(), getInstances: () => instances }));

const dir = mkdtempSync(join(tmpdir(), 'caddy-ui-maintenance-'));
process.env.MAINTENANCE_PATH = join(dir, 'maintenance.json');
process.env.WWW_PATH = join(dir, 'www');
process.env.CADDY_UI_URL = 'caddy-ui-backend:3001';
const maintenance = await import('../src/maintenance.js');
const { readContainerFile } = await import('../src/containerFs.js');
const { default: routesRouter } = await import('../src/routes/routes.js');

const instance = id => ({ id, name: id, adminUrl: `http://${id}:2019`, configPath: `/etc/${id}/Caddyfile`, logPath: '/var/log/caddy/access.log', dataPath: '/data/caddy', containerName: '', serverName: 'srv0' });
const alpha = instance('alpha');
const beta = instance('beta');
const site = (upstream) => `app.example.com {\n    reverse_proxy ${upstream}\n}\n`;
const savedFile = () => JSON.parse(readFileSync(process.env.MAINTENANCE_PATH, 'utf8'));

async function resetState(contents) {
    if (contents === undefined) {
        writeFileSync(process.env.MAINTENANCE_PATH, '{}');
    } else {
        writeFileSync(process.env.MAINTENANCE_PATH, JSON.stringify(contents));
    }
    await maintenance.loadMaintenance();
}

afterAll(() => rmSync(dir, { recursive: true, force: true }));

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

    it("doesn't give saved state to an instance removed while the claim read it", async () => {
        await resetState({ 'app.example.com': { originalContent: 'legacy block' } });
        await maintenance.claimUnassignedMaintenance([alpha, beta], async inst => {
            instances.splice(instances.indexOf(beta), 1);
            return inst.id === 'beta';
        });
        expect(maintenance.getMaintenanceState('beta')).toEqual({});
        expect(maintenance.hasUnassignedMaintenance()).toBe(true);
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

    it("retries a claim that couldn't read an instance after a later monitor round", async () => {
        const served = `app.example.com {\n    rewrite * /public/responses/maintenance\n    reverse_proxy caddy-ui-backend:3001\n}\n`;
        files.set(alpha.configPath, served);
        await resetState({ 'app.example.com': { originalContent: site('alpha-app:3000'), enabledAt: '2026-01-01T00:00:00.000Z' } });
        files.delete(beta.configPath);
        await maintenance.claimSavedMaintenance();
        expect(maintenance.hasUnassignedMaintenance()).toBe(true);

        // Only the round of the instance that couldn't be read retries, and only it is read again
        files.set(beta.configPath, site('beta-app:3000'));
        expect(maintenance.retrySavedMaintenanceClaim('alpha')).toBeUndefined();
        readContainerFile.mockClear();
        await maintenance.retrySavedMaintenanceClaim('beta');
        expect(readContainerFile.mock.calls.map(([, path]) => path)).toEqual([beta.configPath]);
        expect(maintenance.getMaintenanceState('alpha')['app.example.com'].originalContent).toBe(site('alpha-app:3000'));
    });

    it('does not retry a claim that read every instance and matched nothing', async () => {
        await resetState({ 'app.example.com': { originalContent: 'legacy block' } });
        await maintenance.claimSavedMaintenance();
        files.set(alpha.configPath, 'app.example.com {\n    rewrite * /public/responses/maintenance\n}\n');
        for (const { id } of [alpha, beta]) {
            expect(maintenance.retrySavedMaintenanceClaim(id)).toBeUndefined();
        }
        expect(maintenance.hasUnassignedMaintenance()).toBe(true);
        // An instance save still tries again
        await maintenance.claimSavedMaintenance();
        expect(maintenance.hasUnassignedMaintenance()).toBe(false);
    });

    it('creates the default maintenance page only when there is none', async () => {
        const page = join(process.env.WWW_PATH, 'maintenance.html');
        rmSync(page, { recursive: true, force: true });
        mkdirSync(page, { recursive: true });
        await expect(maintenance.getMaintenancePage()).rejects.toMatchObject({ code: 'EISDIR' });
        rmSync(page, { recursive: true });
        expect(await maintenance.getMaintenancePage()).toContain('Under Maintenance');
        writeFileSync(page, 'custom page');
        expect(await maintenance.getMaintenancePage()).toBe('custom page');
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
        server = await serve(app => {
            app.use('/api', (req, res, next) => {
                req.instance = instances.find(i => i.id === req.headers['x-instance-id']);
                next();
            });
            app.use('/api/routes', routesRouter);
        });
        baseUrl = server.url + '/api/routes';
    });

    afterAll(() => server.close());

    const call = (method, path, instanceId) => fetch(baseUrl + path, { method, headers: { 'X-Instance-Id': instanceId } });
    const toggle = (method, instanceId) => call(method, '/caddyfile/app.example.com/maintenance', instanceId);

    it("disabling on one instance can't restore another instance's saved block", async () => {
        expect((await toggle('POST', 'alpha')).status).toBe(200);
        expect(files.get(alpha.configPath)).toContain('/public/responses/maintenance');

        expect((await toggle('DELETE', 'beta')).status).toBe(404);
        expect(files.get(beta.configPath)).toBe(site('beta-app:3000'));
        expect(await (await call('GET', '/maintenance', 'beta')).json()).toEqual({});

        expect((await toggle('DELETE', 'alpha')).status).toBe(200);
        expect(files.get(alpha.configPath)).toContain('reverse_proxy alpha-app:3000');
        expect(files.get(alpha.configPath)).not.toContain('/public/responses/maintenance');
    });

    it('enables maintenance for the same hostname on both instances independently', async () => {
        expect((await toggle('POST', 'alpha')).status).toBe(200);
        expect((await toggle('POST', 'beta')).status).toBe(200);
        expect((await toggle('DELETE', 'beta')).status).toBe(200);
        expect(files.get(beta.configPath)).toContain('reverse_proxy beta-app:3000');
        expect(files.get(alpha.configPath)).toContain('/public/responses/maintenance');
    });

    it('lets the instance serving the page disable maintenance saved before the upgrade', async () => {
        expect((await toggle('POST', 'alpha')).status).toBe(200);
        const { originalContent, enabledAt } = maintenance.getMaintenanceState('alpha')['app.example.com'];
        await resetState({ 'app.example.com': { originalContent, enabledAt } });
        expect(await (await call('GET', '/maintenance', 'alpha')).json()).toEqual({});

        // Assigned at startup or when an instance is saved, not by a request
        await maintenance.claimSavedMaintenance();
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

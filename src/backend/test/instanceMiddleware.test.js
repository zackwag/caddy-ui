import { once } from 'node:events';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const instance = (id) => ({
    id,
    name: id,
    adminUrl: `http://${id}:2019`,
    configPath: '/etc/caddy/Caddyfile',
    logPath: '/var/log/caddy/access.log',
    dataPath: '/data/caddy',
    containerName: '',
    serverName: 'srv0',
});

let dir;
let server;
let baseUrl;
let instances;
const handler = vi.fn((req, res) => res.json({ instance: req.instance.id }));

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'caddy-ui-instances-'));
    process.env.INSTANCES_PATH = join(dir, 'instances.json');
    instances = await import('../src/instances.js');
    const { instanceMiddleware } = await import('../src/middleware/instance.js');

    const app = express();
    app.use('/api', instanceMiddleware);
    app.get('/api/caddyfile', handler);
    app.put('/api/caddyfile', handler);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}/api/caddyfile`;
});

afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
    delete process.env.INSTANCES_PATH;
});

beforeEach(async () => {
    handler.mockClear();
    await writeFile(process.env.INSTANCES_PATH, JSON.stringify([instance('alpha'), instance('beta')]));
    await instances.loadInstances();
});

const send = (method, instanceId) => fetch(baseUrl, {
    method,
    headers: instanceId === undefined ? {} : { 'X-Instance-Id': instanceId },
});

describe('instance selection', () => {
    it('selects the requested instance', async () => {
        const res = await send('GET', 'beta');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ instance: 'beta' });
    });

    it.each([
        ['omitted', undefined],
        ['the default alias', 'default'],
    ])('falls back to the first instance when the selection is %s', async (_, instanceId) => {
        const res = await send('GET', instanceId);
        expect(await res.json()).toEqual({ instance: 'alpha' });
    });

    it('prefers an instance whose id is default when one exists', async () => {
        await writeFile(process.env.INSTANCES_PATH, JSON.stringify([instance('alpha'), instance('default')]));
        await instances.loadInstances();
        expect(await (await send('GET')).json()).toEqual({ instance: 'default' });
    });

    it('rejects an unknown explicit selection instead of using another instance', async () => {
        const res = await send('GET', 'deleted-instance');
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ code: 'INSTANCE_SELECTION_INVALID' });
        expect(handler).not.toHaveBeenCalled();
    });

    it.each(['GET', 'PUT'])('rejects %s with a stale selection after the instance is removed', async (method) => {
        expect((await send(method, 'beta')).status).toBe(200);
        await instances.removeInstance('beta');
        handler.mockClear();

        const res = await send(method, 'beta');
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ code: 'INSTANCE_SELECTION_INVALID' });
        expect(handler).not.toHaveBeenCalled();
    });

    it('still reports NO_INSTANCES when nothing is configured', async () => {
        await writeFile(process.env.INSTANCES_PATH, '[]');
        await instances.loadInstances();
        const res = await send('GET', 'beta');
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ code: 'NO_INSTANCES' });
    });
});

describe('failed save does not leak in-memory mutations', () => {
    it('update rolls back when the write fails', async () => {
        const before = instances.getInstance('alpha');
        await chmod(process.env.INSTANCES_PATH, 0o444);
        try {
            await expect(instances.updateInstance('alpha', { configPath: '/etc/hostname' })).rejects.toThrow();
            expect(instances.getInstance('alpha').configPath).toBe(before.configPath);
        } finally {
            await chmod(process.env.INSTANCES_PATH, 0o644);
        }
    });

    it('add rolls back when the write fails', async () => {
        const countBefore = instances.getInstances().length;
        await chmod(process.env.INSTANCES_PATH, 0o444);
        try {
            await expect(instances.addInstance(instance('gamma'))).rejects.toThrow();
            expect(instances.getInstances().length).toBe(countBefore);
        } finally {
            await chmod(process.env.INSTANCES_PATH, 0o644);
        }
    });

    it('remove rolls back when the write fails', async () => {
        const countBefore = instances.getInstances().length;
        await chmod(process.env.INSTANCES_PATH, 0o444);
        try {
            await expect(instances.removeInstance('beta')).rejects.toThrow();
            expect(instances.getInstances().length).toBe(countBefore);
            expect(instances.getInstance('beta')).toBeTruthy();
        } finally {
            await chmod(process.env.INSTANCES_PATH, 0o644);
        }
    });
});

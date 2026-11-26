import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const instance = id => ({
    id, name: id, adminUrl: `http://${id}:2019`, configPath: '/etc/caddy/Caddyfile',
    logPath: '/var/log/caddy/access.log', dataPath: '/data/caddy', containerName: '', serverName: 'srv0',
});

let directory, file, instances;
beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'caddy-ui-instance-store-'));
    file = join(directory, 'instances.json');
    process.env.INSTANCES_PATH = file;
    await writeFile(file, JSON.stringify([instance('alpha'), instance('beta')]));
    // loadInstances reloads data, not the module's write queue. Each test owns
    // a new module so a rejected operation cannot contaminate the next case.
    vi.resetModules();
    instances = await import('../src/instances.js');
    await instances.loadInstances();
});
afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    delete process.env.INSTANCES_PATH;
});

const expectPersisted = async () => {
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(instances.getInstances());
};

describe('queued instance changes', () => {
    it('retains both overlapping additions in memory and on disk', async () => {
        await Promise.all([instances.addInstance(instance('gamma')), instances.addInstance(instance('delta'))]);
        expect(instances.getInstances().map(value => value.id)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
        await expectPersisted();
    });

    it('retains overlapping updates to different instances', async () => {
        const results = await Promise.all([
            instances.updateInstance('alpha', { name: 'Alpha updated' }),
            instances.updateInstance('beta', { name: 'Beta updated' }),
        ]);
        expect(results.map(value => value.name)).toEqual(['Alpha updated', 'Beta updated']);
        expect(instances.getInstances().map(value => value.name)).toEqual(['Alpha updated', 'Beta updated']);
        await expectPersisted();
    });

    it('merges overlapping field changes on the same instance', async () => {
        const [first, second] = await Promise.all([
            instances.updateInstance('alpha', { name: 'Alpha updated' }),
            instances.updateInstance('alpha', { serverName: 'srv2' }),
        ]);
        expect(first).toMatchObject({ name: 'Alpha updated', serverName: 'srv0' });
        expect(second).toMatchObject({ name: 'Alpha updated', serverName: 'srv2' });
        expect(instances.getInstance('alpha')).toEqual(second);
        await expectPersisted();
    });

    it('does not resurrect an instance removed alongside an unrelated edit', async () => {
        await Promise.all([
            instances.removeInstance('beta'),
            instances.updateInstance('alpha', { name: 'Alpha updated' }),
        ]);
        expect(instances.getInstances()).toEqual([{ ...instance('alpha'), name: 'Alpha updated' }]);
        await expectPersisted();
    });

    it('checks duplicate IDs against previously queued additions', async () => {
        const results = await Promise.allSettled([
            instances.addInstance(instance('gamma')),
            instances.addInstance({ ...instance('gamma'), name: 'Duplicate' }),
        ]);
        expect(results[0].status).toBe('fulfilled');
        expect(results[1].status).toBe('rejected');
        expect(results[1].reason).toMatchObject({ code: 'CONFLICT' });
        expect(instances.getInstance('gamma').name).toBe('gamma');
        await expectPersisted();
    });

    it('rejects an update after an earlier queued removal of its target', async () => {
        const results = await Promise.allSettled([
            instances.removeInstance('beta'),
            instances.updateInstance('beta', { name: 'Removed instance' }),
        ]);
        expect(results[0].status).toBe('fulfilled');
        expect(results[1].status).toBe('rejected');
        expect(results[1].reason).toMatchObject({ code: 'INSTANCE_NOT_FOUND' });
        expect(instances.getInstance('beta')).toBeNull();
        await expectPersisted();
    });
});

describe('failed instance changes', () => {
    const changes = {
        add: () => instances.addInstance(instance('gamma')),
        update: () => instances.updateInstance('alpha', { configPath: '/etc/caddy/changed.Caddyfile' }),
        remove: () => instances.removeInstance('beta'),
    };

    it.each(Object.keys(changes))('%s keeps memory unchanged on a failed write and works after repair', async operation => {
        // A writable success control for every isolated failure case.
        await instances.updateInstance('alpha', { name: 'Alpha baseline' });
        await expectPersisted();
        const before = structuredClone(instances.getInstances());
        const persisted = await readFile(file, 'utf8');
        // A directory in place of the file fails the write for any user, root included.
        await rm(file);
        await mkdir(file);
        await expect(changes[operation]()).rejects.toMatchObject({ code: 'EISDIR' });
        expect(instances.getInstances()).toEqual(before);
        await rm(file, { recursive: true });
        await writeFile(file, persisted);

        // Reloading data must not hide a poisoned write queue. Retrying the
        // operation needs to reach the now-writable file and update both views.
        await instances.loadInstances();
        await changes[operation]();
        if (operation === 'add') expect(instances.getInstance('gamma')).toEqual(instance('gamma'));
        if (operation === 'update') expect(instances.getInstance('alpha').configPath).toBe('/etc/caddy/changed.Caddyfile');
        if (operation === 'remove') expect(instances.getInstance('beta')).toBeNull();
        await expectPersisted();
    });

    it.each([
        ['duplicate ID', () => instances.addInstance(instance('alpha')), 'CONFLICT'],
        ['unknown ID', () => instances.updateInstance('missing', { name: 'Missing' }), 'INSTANCE_NOT_FOUND'],
    ])('rejects a %s without preventing the next valid change', async (_, change, code) => {
        await expect(change()).rejects.toMatchObject({ code });
        await instances.addInstance(instance('gamma'));
        expect(instances.getInstance('gamma')).toEqual(instance('gamma'));
        await expectPersisted();
    });
});

describe('stored instances', () => {
    const reload = async contents => {
        await writeFile(file, JSON.stringify(contents));
        return instances.loadInstances();
    };

    it('normalizes a hand-edited file into the form requests use', async () => {
        const [loaded] = await reload([{ id: 'alpha', adminUrl: 'http://Caddy:2019/', configPath: '/etc/caddy/../caddy/Caddyfile', containerName: 'cad dy' }]);
        expect(loaded).toEqual({
            id: 'alpha', name: 'alpha', adminUrl: 'http://caddy:2019', configPath: '/etc/caddy/Caddyfile',
            logPath: '/var/log/caddy/access.log', dataPath: '/data/caddy', containerName: 'caddy', serverName: 'srv0',
        });
        expect(instances.getInstance('alpha')).toBe(loaded);
    });

    it('treats a missing container name as local mode', async () => {
        const { containerName, ...local } = instance('alpha');
        expect(containerName).toBe('');
        await reload([local]);
        expect(instances.getInstance('alpha').containerName).toBe('');
    });

    it.each([
        ['an admin URL that is not http', { adminUrl: 'ftp://caddy:2019' }],
        ['a path outside the allowed directories', { configPath: '/root/Caddyfile' }],
        ['an instance without an id', { id: undefined }],
    ])('sets aside a file with %s instead of using it', async (_, override) => {
        expect(await reload([instance('beta'), { ...instance('alpha'), ...override }])).toEqual([]);
        expect((await readdir(directory)).some(name => name.startsWith('instances.json.corrupt-'))).toBe(true);
    });

    it.each([
        ['containerName', 'caddy;rm'],
        ['serverName', 'srv 0'],
        ['adminUrl', 'file:///etc/passwd'],
        ['logPath', '/root/access.log'],
    ])('rejects an added or updated %s that would need changing', async (field, value) => {
        await expect(instances.addInstance({ ...instance('gamma'), [field]: value }))
            .rejects.toMatchObject({ code: 'VALIDATION_FAILED', context: { field } });
        await expect(instances.updateInstance('alpha', { [field]: value }))
            .rejects.toMatchObject({ code: 'VALIDATION_FAILED', context: { field } });
        expect(instances.getInstance('gamma')).toBeNull();
        expect(instances.getInstance('alpha')).toEqual(instance('alpha'));
        await expectPersisted();
    });
});

describe('instance listeners', () => {
    it('tells listeners about each saved instance, without failing the save when one fails', async () => {
        const saved = vi.fn().mockRejectedValueOnce(new Error('listener failed'));
        instances.onInstanceSaved(saved);
        await instances.addInstance(instance('gamma'));
        await instances.updateInstance('alpha', { name: 'Alpha updated' });
        expect(saved.mock.calls).toEqual([['gamma'], ['alpha']]);
        expect(instances.getInstance('gamma')).toEqual(instance('gamma'));
        await expectPersisted();
    });
});

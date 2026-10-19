import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backendEnvironment, checkDocker, defaultCaddyfile, Harness, LABEL, namespace, validateName, withLock } from './harness.mjs';

const project = '0123456789abcdef';
function engine() {
    const containers = new Map();
    const volumes = new Map();
    const calls = [];
    const run = async args => {
        calls.push(args);
        const [command, subcommand] = args;
        if (command === 'ps') {
            const filter = args[args.indexOf('--filter') + 1];
            return [...containers.values()].filter(c => filter.startsWith('name=') ? c.Name === '/' + filter.slice(7, -1) : c.Config.Labels[`${LABEL}.project`] === project).map(c => c.Id).join('\n');
        }
        if (command === 'volume' && subcommand === 'ls') {
            const filter = args[args.indexOf('--filter') + 1];
            return [...volumes.values()].filter(v => filter.startsWith('name=') ? v.Name === filter.slice(6, -1) : v.Labels[`${LABEL}.project`] === project).map(v => v.Name).join('\n');
        }
        if (subcommand === 'inspect') {
            const map = command === 'container' ? containers : volumes;
            return JSON.stringify([map.get(args[2]) || [...map.values()].find(c => c.Id === args[2])]);
        }
        const labels = {};
        args.forEach((arg, i) => { if (arg === '--label') { const [key, value] = args[i + 1].split('='); labels[key] = value; } });
        if (command === 'volume' && subcommand === 'create') {
            volumes.set(args.at(-1), { Name: args.at(-1), Labels: labels });
        } else if (command === 'create') {
            const name = args[args.indexOf('--name') + 1];
            containers.set(name, { Id: `id-${name}`, Name: '/' + name, Config: { Labels: labels }, State: { Running: false },
                NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '8001' }], '2019/tcp': [{ HostPort: '9001' }] } } });
        } else if (command === 'start' || command === 'stop') {
            const c = containers.get(subcommand) || [...containers.values()].find(c => c.Id === subcommand);
            c.State.Running = command === 'start';
        } else if (command === 'rm') {
            const c = [...containers.values()].find(c => c.Id === args.at(-1));
            containers.delete(c.Name.slice(1));
        } else if (command === 'volume' && subcommand === 'rm') volumes.delete(args.at(-1));
        else throw new Error(`Unexpected Docker call: ${args.join(' ')}`);
        return '';
    };
    return { run, calls, containers, volumes };
}

// Keep networking deterministic and independent of the test runner's container.
for (const key of ['REMOTE_CONTAINERS', 'CODESPACES', 'DEV_CADDY_NETWORK']) delete process.env[key];

test('rejects unsafe names and namespaces before Docker calls', () => {
    for (const name of ['../prod', '--all', 'Name', '', 'a;rm', 'a'.repeat(33)]) assert.throws(() => validateName(name));
    assert.throws(() => new Harness('production'));
    assert.match(defaultCaddyfile('alpha'), /respond \/health "ok" 200/);
    assert.match(defaultCaddyfile('alpha'), /503/);
});

test('create is repeatable, restarts stopped instances and retains volumes on removal', async () => {
    const e = engine();
    const h = new Harness(project, e.run);
    const info = await h.create('alpha');
    assert.equal(info.instance.adminUrl, 'http://127.0.0.1:9001');
    await h.create('alpha');
    assert.equal(e.calls.filter(c => c[0] === 'create').length, 1);
    await h.stop('alpha');
    await h.create('alpha');
    assert.equal(e.calls.filter(c => c[0] === 'start').length, 2);
    await h.create('beta');
    assert.equal(e.containers.size, 2);
    await h.remove('alpha');
    assert.equal(e.containers.size, 1);
    assert.equal(e.volumes.size, 2);
    await h.create('alpha');
    assert.equal(e.calls.filter(c => c[0] === 'volume' && c[1] === 'create').length, 2);
});

test('bulk removal requires confirmation and only purges this namespace', async () => {
    const e = engine();
    const h = new Harness(project, e.run);
    await h.create('alpha');
    e.volumes.set('production', { Name: 'production', Labels: {} });
    await assert.rejects(h.removeAll(), /confirmation/);
    assert.equal(e.containers.size, 1);
    await h.removeAll({ confirmed: true, purge: true });
    assert.equal(e.containers.size, 0);
    assert.deepEqual([...e.volumes.keys()], ['production']);
    await h.removeAll({ confirmed: true, purge: true });
});

test('refuses an unrelated container or volume with a colliding name', async () => {
    const e = engine();
    const h = new Harness(project, e.run);
    e.containers.set(h.resource('alpha'), { Id: 'foreign', Name: '/' + h.resource('alpha'), Config: { Labels: {} } });
    await assert.rejects(h.remove('alpha', true), /ownership/);
    await assert.rejects(h.create('alpha'), /ownership/);
    assert.ok(!e.calls.some(c => ['rm', 'stop', 'start'].includes(c[0])));
    e.containers.clear();
    e.volumes.set(h.resource('alpha'), { Name: h.resource('alpha'), Labels: {} });
    await assert.rejects(h.create('alpha'), /ownership/);
    await assert.rejects(h.remove('alpha', true), /ownership/);
});

test('preflights bulk ownership and cleans orphan volumes', async () => {
    const e = engine();
    const h = new Harness(project, e.run);
    await h.create('alpha');
    await h.create('beta');
    e.containers.get(h.resource('beta')).Config.Labels[`${LABEL}.instance`] = 'wrong';
    await assert.rejects(h.removeAll({ confirmed: true, purge: true }), /ownership/);
    assert.equal(e.containers.size, 2);
    e.containers.get(h.resource('beta')).Config.Labels[`${LABEL}.instance`] = 'beta';
    await h.remove('beta');
    await h.removeAll({ confirmed: true, purge: true });
    assert.equal(e.volumes.size, 0);
});

test('Docker failures are actionable and never treated as missing resources', async () => {
    const fail = async () => { throw new Error('permission denied'); };
    await assert.rejects(checkDocker(fail), /docker-outside-of-docker/);
    await assert.rejects(new Harness(project, fail).create('alpha'), /permission denied/);
});

test('namespace persists and lock rejects concurrent lifecycle mutation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-harness-'));
    try {
        await withLock(directory, async () => {
            assert.equal(await namespace(directory), await namespace(directory));
            await assert.rejects(withLock(directory, () => {}), /Another lifecycle/);
        });
        await withLock(directory, () => {});
    } finally { await rm(directory, { recursive: true }); }
});

test('all backend state overrides are isolated even with inherited production paths', () => {
    const env = backendEnvironment('/tmp/dev-sandbox', { adminUrl: 'http://127.0.0.1:9001', containerName: 'test' });
    for (const [key, value] of Object.entries(env)) {
        if (['AUTH_PATH', 'INSTANCES_PATH', 'SETTINGS_PATH', 'SERVER_NAMES_PATH', 'UPTIME_HISTORY_PATH', 'NOTIFICATIONS_CONFIG_PATH',
            'ROUTE_NOTES_PATH', 'HISTORY_PATH', 'MAINTENANCE_PATH', 'WWW_PATH', 'THEMES_PATH'].includes(key)) {
            assert.ok(value.startsWith('/tmp/dev-sandbox/backend/'), key);
        }
    }
    assert.equal(env.CADDY_UI_UPDATE_CHECK, 'false');
    assert.equal(env.CADDY_UI_TRUSTED_PROXIES, '');
});

test('Dev Container network selection is explicit and never mutates the Dev Container', async () => {
    const calls = [];
    const run = async args => {
        calls.push(args);
        return JSON.stringify([{ NetworkSettings: { Networks: { 'dev-network': { IPAddress: '172.25.0.2' } } } }]);
    };
    process.env.REMOTE_CONTAINERS = 'true';
    try {
        assert.equal(await new Harness(project, run).network(), 'dev-network');
        assert.deepEqual(calls.map(c => c.slice(0, 2)), [['container', 'inspect']]);
        process.env.DEV_CADDY_NETWORK = 'explicit-network';
        assert.equal(await new Harness(project, run).network(), 'explicit-network');
        assert.equal(calls.length, 1);
    } finally {
        delete process.env.REMOTE_CONTAINERS;
        delete process.env.DEV_CADDY_NETWORK;
    }
});

test('ambiguous Dev Container networking fails with an actionable override', async () => {
    process.env.REMOTE_CONTAINERS = 'true';
    try {
        const run = async () => JSON.stringify([{ NetworkSettings: { Networks: { first: {}, second: {} } } }]);
        await assert.rejects(new Harness(project, run).network(), /DEV_CADDY_NETWORK/);
    } finally { delete process.env.REMOTE_CONTAINERS; }
});

test('a lifecycle failure releases its checkout lock', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-harness-'));
    try {
        await assert.rejects(withLock(directory, () => { throw new Error('create failed'); }), /create failed/);
        await withLock(directory, () => {});
    } finally { await rm(directory, { recursive: true }); }
});

test('purge preflights a colliding foreign volume before removing the owned container', async () => {
    const e = engine();
    const h = new Harness(project, e.run);
    await h.create('alpha');
    e.volumes.get(h.resource('alpha')).Labels = {};
    await assert.rejects(h.remove('alpha', true), /ownership/);
    assert.equal(e.containers.size, 1);
    assert.equal(e.volumes.size, 1);
});

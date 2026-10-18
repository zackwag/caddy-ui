import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { Harness } from '../dev-caddy/harness.mjs';
import { captureDashboard } from './capture.mjs';
import { sourceFingerprint } from './capture-source.mjs';

async function assertClean(scope) {
    assert.deepEqual(await scope.names(), []);
    assert.deepEqual(await scope.names('volume'), []);
}

test('capture real Dashboard, notification, observability, TLS, sidebar, route and history reads, retaining no resources and leaving unrelated instances untouched', { timeout: 60000 }, async t => {
    const directory = await mkdtemp(resolve(tmpdir(), 'preview-capture-check-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const unrelated = new Harness(randomBytes(8).toString('hex'));
    t.after(() => unrelated.removeAll({ confirmed: true, purge: true }));
    await unrelated.create('sentinel');
    const container = await unrelated.inspect('container', unrelated.resource('sentinel'));
    const volume = await unrelated.inspect('volume', unrelated.resource('sentinel'));
    let scope;
    const output = resolve(directory, 'dashboard.json');
    const backendPids = [];
    const capture = await captureDashboard({ output, onBackend: pid => backendPids.push(pid), onNamespace: project => { scope = new Harness(project); } });
    assert.equal(capture.source.sourceHash, await sourceFingerprint());
    assert.equal(capture.csrfContext.record.request.path, '/auth/csrf');
    assert.equal(capture.csrfContext.record.response.body.csrfToken, 'offline-preview-context');
    assert.deepEqual(capture.scenarios.map(scenario => scenario.id), ['dashboard-online', 'dashboard-empty', 'dashboard-stopped', 'notifications-default', 'metrics-enabled', 'logs-default', 'tls-default', 'sidebar-online', 'sidebar-stopped', 'routes-online', 'routes-empty', 'route-history-empty', 'caddyfile-empty', 'caddyfile-history', 'routes-edit-unavailable', 'tls-internal-valid', 'tls-internal-orphaned', 'uptime-route-pending', 'instances-local', 'instances-missing-server', 'instances-empty']);
    const notifications = capture.scenarios.find(scenario => scenario.id === 'notifications-default');
    assert.equal(notifications.requests.length, 1);
    const [record] = notifications.requests;
    assert.deepEqual(record.request, { method: 'GET', path: '/notifications/config', body: null });
    assert.equal(record.response.status, 200);
    assert.equal(record.response.body.enabled, false);
    assert.equal(record.response.body.ntfy.url, '');
    assert.equal(record.response.body.pushover.userKey, '');
    assert.equal(record.response.body.pushover.apiToken, '');
    const metrics = capture.scenarios.find(scenario => scenario.id === 'metrics-enabled');
    assert(metrics.requests.every(record => record.request.method === 'GET' && record.response.status === 200));
    assert.equal(metrics.requests.find(record => record.request.path === '/metrics').response.body.ok, true);
    assert.equal(metrics.requests.find(record => record.request.path === '/auth/status').response.body.publicMetrics, false);
    const logs = capture.scenarios.find(scenario => scenario.id === 'logs-default');
    assert.deepEqual(logs.requests.map(record => record.request.path), ['/logs', '/logs/config']);
    assert(logs.requests.every(record => record.request.method === 'GET' && record.response.status === 200));
    const lines = logs.requests[0].response.body.lines.map(line => JSON.parse(line));
    assert(lines.some(line => line.status === 200));
    assert(lines.some(line => line.status === 503));
    assert(lines.every(line => /^192\.0\.2\.\d+$/.test(line.request.remote_ip)));
    assert.equal(logs.requests[1].response.body.enabled, false);
    const tls = capture.scenarios.find(scenario => scenario.id === 'tls-default');
    assert.deepEqual(tls.requests.map(record => record.request.path), ['/tls']);
    assert.deepEqual(tls.requests[0].response.body, []);
    for (const id of ['sidebar-online', 'sidebar-stopped']) {
        const sidebar = capture.scenarios.find(scenario => scenario.id === id);
        assert.deepEqual(sidebar.requests.map(record => record.request.path),
            ['/version?frontend=dev', '/instances', '/instances/status', '/status']);
        assert(sidebar.requests.every(record => record.request.method === 'GET' && record.response.status === 200));
        assert.equal(sidebar.requests[0].response.body.version, 'dev-caddy-preview');
        assert.equal(sidebar.requests[3].response.body.online, id === 'sidebar-online');
        assert.equal(sidebar.requests[2].response.body[0].online, id === 'sidebar-online');
    }
    for (const id of ['routes-online', 'routes-empty']) {
        const routes = capture.scenarios.find(scenario => scenario.id === id);
        assert.deepEqual(routes.requests.map(record => record.request.path),
            ['/routes', '/tls', '/route-notes', '/server-names', '/routes/maintenance', '/health', '/health/uptime']);
        assert(routes.requests.every(record => record.request.method === 'GET' && record.response.status === 200));
        assert.equal(routes.requests[0].response.body.length > 0, id === 'routes-online');
    }
    const history = capture.scenarios.find(scenario => scenario.id === 'route-history-empty');
    assert(Number.isSafeInteger(history.clock));
    assert.deepEqual(history.requests.map(record => record.request.path), [1, 6, 24, 168].map(hours =>
        `/health/history?route=preview.home.arpa&since=${history.clock - hours * 60 * 60 * 1000}`));
    assert(history.requests.every(record => record.request.method === 'GET' && record.response.status === 200 &&
        record.response.body.entries.length === 0 && record.response.body.intervalMs > 0));
    const emptyEditor = capture.scenarios.find(scenario => scenario.id === 'caddyfile-empty');
    assert.deepEqual(emptyEditor.requests[1].response.body, []);
    const editor = capture.scenarios.find(scenario => scenario.id === 'caddyfile-history');
    const file = editor.requests[0].response.body;
    const entries = editor.requests[1].response.body;
    assert(entries.length >= 2);
    const snapshots = entries.map(entry => editor.requests.find(record => record.request.path === `/caddyfile/history/${entry.filename}`));
    assert.equal(snapshots[0].response.body, file);
    assert.notEqual(snapshots.at(-1).response.body, file);
    assert.deepEqual(editor.requests.filter(record => record.request.method !== 'GET').map(record => record.request.path),
        ['/caddyfile/validations?fmt=true']);
    const validation = editor.requests.at(-1);
    assert.equal(validation.request.body, file);
    assert.equal(validation.response.body.valid, true);
    assert.deepEqual(validation.response.body.warnings, []);
    const edit = capture.scenarios.find(scenario => scenario.id === 'routes-edit-unavailable');
    assert(edit.requests.at(-1).response.status >= 400);
    assert(edit.requests.every(record => record.request.method === 'GET'));
    for (const [id, status] of [['tls-internal-valid', 'valid'], ['tls-internal-orphaned', 'orphaned']]) {
        const profile = capture.scenarios.find(scenario => scenario.id === id);
        assert.equal(profile.requests.length, 1);
        const [cert] = profile.requests[0].response.body;
        assert.equal(profile.requests[0].response.body.length, 1);
        assert.equal(cert.domain, 'preview.internal');
        assert.equal(cert.isInternal, true);
        assert.equal(cert.status, status);
    }
    const pending = capture.scenarios.find(scenario => scenario.id === 'uptime-route-pending');
    assert(pending.requests[0].response.body.some(route => route.match?.some(match => match.host?.includes('preview.internal'))));
    assert.deepEqual(pending.requests.find(record => record.request.path === '/health/uptime?kind=route').response.body, {});
    for (const id of ['instances-local', 'instances-missing-server', 'instances-empty']) {
        const profile = capture.scenarios.find(scenario => scenario.id === id);
        assert(profile.requests.every(record => record.request.method === 'GET'));
        assert.deepEqual(profile.requests.find(record => record.request.path === '/instances/discover').response.body, []);
        if (id === 'instances-empty') {
            assert.deepEqual(profile.requests[0].response.body, []);
            assert.equal(profile.requests.find(record => record.request.path === '/server-names/all').response.status, 503);
        } else {
            const [instance] = profile.requests[0].response.body;
            assert.equal(instance.containerName, '');
            assert.equal(instance.adminUrl, 'http://caddy-preview:2019');
            const lookup = profile.requests.find(record => record.request.path.startsWith('/instances/servers?'));
            assert.equal(lookup.request.path, '/instances/servers?adminUrl=http%3A%2F%2Fcaddy-preview%3A2019');
            assert.equal(lookup.response.body.includes('srv0'), id === 'instances-local');
        }
    }
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), capture);
    await assertClean(scope);
    assert.equal(backendPids.length, 2);
    for (const pid of backendPids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    const retained = await unrelated.inspect('container', unrelated.resource('sentinel'));
    assert.equal(retained.Id, container.Id);
    assert.equal(retained.State.Running, true);
    assert.deepEqual(await unrelated.inspect('volume', unrelated.resource('sentinel')), volume);
});

test('failed backend startup keeps the previous artifact and removes capture resources', { timeout: 60000 }, async t => {
    const directory = await mkdtemp(resolve(tmpdir(), 'preview-capture-failure-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const output = resolve(directory, 'dashboard.json');
    await writeFile(output, 'previous artifact');
    let scope;
    await assert.rejects(captureDashboard({ output, backendEntry: resolve(directory, 'missing-backend.mjs'),
        onNamespace: project => { scope = new Harness(project); } }), error => {
        assert.match(error.cause.message, /Capture backend exited/);
        return true;
    });
    assert.equal(await readFile(output, 'utf8'), 'previous artifact');
    await assertClean(scope);
});

test('interrupting capture cleans up its own resources without publishing an artifact', { timeout: 60000 }, async t => {
    const directory = await mkdtemp(resolve(tmpdir(), 'preview-capture-interrupt-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const output = resolve(directory, 'dashboard.json');
    const child = spawn(process.execPath, [resolve(import.meta.dirname, 'capture.mjs'), output], { stdio: 'pipe' });
    let log = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log += data; });
    const closed = new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await closed; }
    });
    const deadline = Date.now() + 15000;
    let scope;
    while (Date.now() < deadline) {
        const namespace = log.match(/Capture owns Docker namespace ([a-f0-9]{16})/);
        if (namespace) scope = new Harness(namespace[1]);
        if (scope && (await scope.names()).length) break;
        assert.equal(child.exitCode, null, log);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(scope, log);
    child.kill('SIGTERM');
    assert.equal(await closed, 1, log);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
    await assertClean(scope);
});

test('failure after starting the local-mode backend removes both backends and retains the previous artifact', { timeout: 60000 }, async t => {
    const directory = await mkdtemp(resolve(tmpdir(), 'preview-local-backend-failure-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const output = resolve(directory, 'dashboard.json');
    await writeFile(output, 'previous artifact');
    const backendPids = [];
    let scope;
    await assert.rejects(captureDashboard({ output, onNamespace: project => { scope = new Harness(project); },
        onBackend: pid => {
            backendPids.push(pid);
            if (backendPids.length === 2) throw new Error('Deliberate failure after local backend start');
        },
    }), error => {
        assert.match(error.cause.message, /Deliberate failure after local backend start/);
        return true;
    });
    assert.equal(backendPids.length, 2);
    for (const pid of backendPids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal(await readFile(output, 'utf8'), 'previous artifact');
    await assertClean(scope);
});

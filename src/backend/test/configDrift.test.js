import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeExpectation } from '../src/configExpectation.js';

const { files, live, instances, unsettled } = vi.hoisted(() => ({
    files: new Map(),
    // The running config each instance's admin API serves, by admin URL
    live: new Map(),
    instances: [],
    unsettled: new Set(),
}));

vi.mock('../src/containerFs.js', () => ({
    readContainerFile: vi.fn(async (container, path) => {
        if (!files.has(path)) throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
        return files.get(path);
    }),
}));
vi.mock('../src/caddy.js', () => ({
    caddyGetConfig: vi.fn(async adminUrl => {
        if (!live.has(adminUrl)) throw Object.assign(new Error('Caddy API error: 503'), { status: 503 });
        // Like Caddy's ETag: a hash of the config, never the config itself
        const { createHash } = await import('node:crypto');
        const digest = createHash('sha256').update(JSON.stringify(live.get(adminUrl))).digest('hex').slice(0, 16);
        return { config: live.get(adminUrl), fingerprint: `etag:"/config/ ${digest}"` };
    }),
    hasUnsettledWrites: adminUrl => unsettled.has(adminUrl),
}));
vi.mock('../src/instances.js', () => ({ getInstances: () => instances }));

const { default: logger } = await import('../src/logger.js');
const historyRoot = await mkdtemp(join(tmpdir(), 'caddy-ui-drift-history-'));
process.env.HISTORY_PATH = historyRoot;
afterAll(async () => { await rm(historyRoot, { recursive: true, force: true }); delete process.env.HISTORY_PATH; });
const { configurationHistory: history } = await import('../src/configurationHistory.js');
const { DRIFT_HISTORY_LIMIT, checkAllInstances, getConfigDriftState, recordLocalChange, resetConfigDrift } = await import('../src/configDrift.js');

const alpha = { id: 'alpha', name: 'Alpha', adminUrl: 'http://alpha:2019', configPath: '/alpha/Caddyfile', containerName: 'alpha' };
const beta = { id: 'beta', name: 'Beta', adminUrl: 'http://beta:2019', configPath: '/beta/Caddyfile', containerName: 'beta' };
const verified = { file: 'verified', live: 'verified' };

let warn;
let info;
const reports = () => warn.mock.calls.filter(([message]) => message === 'Configuration changed outside caddy-ui');
const changes = id => getConfigDriftState(id).changes;

beforeEach(async () => {
    await rm(historyRoot, { recursive: true, force: true });
    resetConfigDrift();
    files.clear();
    live.clear();
    unsettled.clear();
    instances.splice(0, instances.length, alpha, beta);
    for (const instance of instances) {
        files.set(instance.configPath, `${instance.id}.example.com {\n}\n`);
        live.set(instance.adminUrl, { apps: { http: { servers: { srv0: { routes: [instance.id] } } } } });
    }
    warn = vi.spyOn(logger, 'warn');
    info = vi.spyOn(logger, 'info');
    await checkAllInstances();
});

afterEach(() => vi.restoreAllMocks());

describe('configuration drift detection', () => {
    it.each([
        ['file', ['file']], ['live', ['live']], ['combined', ['file', 'live']],
    ])('persists inspectable %s transitions without exposing their content in list metadata', async (kind, representations) => {
        const beforeFile = files.get(alpha.configPath);
        const beforeLive = structuredClone(live.get(alpha.adminUrl));
        if (representations.includes('file')) files.set(alpha.configPath, 'external-secret.test {}\n');
        if (representations.includes('live')) live.set(alpha.adminUrl, { external: 'external-secret' });
        await checkAllInstances();
        await checkAllInstances();
        const entries = await history.list(alpha.id);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ actor: null, kind: 'external', instanceId: alpha.id, representations, hasFile: representations.includes('file') });
        expect(JSON.stringify(entries)).not.toContain('external-secret');
        const { external } = await history.read(alpha.id, entries[0].filename);
        expect(external.instanceId).toBe(alpha.id);
        expect(external.representations).toEqual(representations);
        expect(Number.isFinite(Date.parse(external.detectedAt))).toBe(true);
        if (representations.includes('file')) {
            expect(external.before.file).toBe(beforeFile);
            expect(external.after.file).toBe(files.get(alpha.configPath));
        }
        if (representations.includes('live')) {
            expect(JSON.parse(external.before.live)).toEqual(beforeLive);
            expect(JSON.parse(external.after.live)).toEqual(live.get(alpha.adminUrl));
        }
    });

    it('diffs subsequent observations against each other, including a return to the expected configuration', async () => {
        const original = files.get(alpha.configPath);
        for (const content of ['first {}', 'second {}', original]) {
            files.set(alpha.configPath, content);
            await checkAllInstances();
        }
        const entries = (await history.list(alpha.id)).reverse();
        const values = await Promise.all(entries.map(entry => history.read(alpha.id, entry.filename)));
        expect(values.map(value => [value.external.before.file, value.external.after.file])).toEqual([
            [original, 'first {}'], ['first {}', 'second {}'], ['second {}', original],
        ]);
    });

    it('continues recording an available representation during an outage and explicitly marks a missing baseline', async () => {
        resetConfigDrift();
        live.delete(alpha.adminUrl);
        await checkAllInstances();
        files.set(alpha.configPath, 'during-outage {}');
        await checkAllInstances();
        live.set(alpha.adminUrl, { new: 'first readable config' });
        await checkAllInstances();
        const entries = await history.list(alpha.id);
        expect(entries).toHaveLength(2);
        const { external } = await history.read(alpha.id, entries[0].filename);
        expect(external.representations).toEqual(['live']);
        expect(external.before.live).toBeNull();
        expect(JSON.parse(external.after.live)).toEqual({ new: 'first readable config' });
    });

    it('does not label a verified full save as external after the live baseline was unavailable', async () => {
        resetConfigDrift();
        live.delete(alpha.adminUrl);
        await checkAllInstances();
        const config = { verified: 'full save' };
        files.set(alpha.configPath, 'verified full save {}');
        live.set(alpha.adminUrl, config);
        await recordLocalChange(alpha, { content: files.get(alpha.configPath), verification: verified, expectLive: () => config });
        await checkAllInstances();
        expect(await history.list(alpha.id)).toEqual([]);
    });

    it('retries a failed history write without adopting the observation or exposing configuration', async () => {
        const expected = getConfigDriftState(alpha.id).expected;
        files.set(alpha.configPath, 'private-history-content {}');
        const record = vi.spyOn(history, 'recordExternal').mockRejectedValueOnce(Object.assign(new Error('sensitive content'), { code: 'EIO' }));
        await checkAllInstances();
        expect(getConfigDriftState(alpha.id).expected).toEqual(expected);
        expect(await history.list(alpha.id)).toEqual([]);
        expect(warn.mock.calls).toContainEqual(['Configuration drift check failed', expect.objectContaining({ code: 'CADDYFILE_HISTORY_WRITE_FAILED' })]);
        expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive content');
        await checkAllInstances();
        expect(record).toHaveBeenCalledTimes(2);
        const [entry] = await history.list(alpha.id);
        expect((await history.read(alpha.id, entry.filename)).external.after.file).toBe('private-history-content {}');
        expect(getConfigDriftState(alpha.id).expected).toEqual(expected);
    });

    it('establishes a baseline at startup without reporting a change', () => {
        expect(info.mock.calls.filter(([message]) => message === 'Configuration baseline established')).toHaveLength(2);
        expect(reports()).toHaveLength(0);
        expect(changes('alpha')).toEqual([]);
    });

    it.each([
        ['file', () => files.set(alpha.configPath, 'edited.example.com {\n}\n'), ['file']],
        ['admin API', () => live.set(alpha.adminUrl, { apps: {} }), ['live']],
        ['combined', () => { files.set(alpha.configPath, 'edited {\n}\n'); live.set(alpha.adminUrl, { apps: {} }); }, ['file', 'live']],
    ])('detects a %s change and which representation changed', async (name, change, representations) => {
        change();
        await checkAllInstances();
        expect(reports()).toHaveLength(1);
        expect(reports()[0][1]).toMatchObject({ instanceId: 'alpha', representations });
        expect(changes('alpha')).toHaveLength(1);
        expect(changes('beta')).toEqual([]);
    });

    it('reports a repeated state once, a distinct later change again, and never adopts either', async () => {
        const expected = getConfigDriftState('alpha').expected;
        files.set(alpha.configPath, 'first {\n}\n');
        await checkAllInstances();
        await checkAllInstances();
        expect(reports()).toHaveLength(1);
        files.set(alpha.configPath, 'second {\n}\n');
        await checkAllInstances();
        expect(reports()).toHaveLength(2);
        expect(changes('alpha').map(change => change.previous)).toEqual([expected, expected]);
        expect(getConfigDriftState('alpha').expected).toEqual(expected);
    });

    it('treats a return to the expected state as settled, so a later recurrence is reported', async () => {
        const original = files.get(alpha.configPath);
        files.set(alpha.configPath, 'edited {\n}\n');
        await checkAllInstances();
        files.set(alpha.configPath, original);
        await checkAllInstances();
        files.set(alpha.configPath, 'edited {\n}\n');
        await checkAllInstances();
        expect(reports()).toHaveLength(2);
    });

    it('does not report a verified local change', async () => {
        files.set(alpha.configPath, 'local {\n}\n');
        live.set(alpha.adminUrl, { apps: { local: true } });
        await recordLocalChange(alpha, { content: 'local {\n}\n', verification: verified, verifyLive: async () => 'verified',
            expectLive: () => ({ apps: { local: true } }) });
        await checkAllInstances();
        expect(reports()).toHaveLength(0);
    });

    it('binds a full-save expectation to its adapter result rather than a later live observation', async () => {
        files.set(alpha.configPath, 'local {\n}\n');
        live.set(alpha.adminUrl, { apps: { local: true, external: true } });
        await recordLocalChange(alpha, { content: 'local {\n}\n', verification: verified,
            expectLive: () => ({ apps: { local: true } }) });
        await checkAllInstances();
        expect(reports()).toHaveLength(1);
        expect(reports()[0][1].representations).toEqual(['live']);
    });

    it('confirms an unverified local change once the running config matches it', async () => {
        files.set(alpha.configPath, 'local {\n}\n');
        await recordLocalChange(alpha, { content: 'local {\n}\n', verification: { file: 'verified', live: 'uncertain' },
            verifyLive: async () => 'verified', expectLive: () => ({ apps: { local: true } }) });
        live.set(alpha.adminUrl, { apps: { local: true } });
        await checkAllInstances();
        expect(reports()).toHaveLength(0);
        expect(info.mock.calls.some(([message]) => message === 'Local configuration change confirmed')).toBe(true);
    });

    it.each([
        ['the file differs from what the change wrote', 'someone-else {\n}\n', async () => 'verified'],
        ['the running config differs from the change', 'local {\n}\n', async () => 'mismatch'],
        ['the running config cannot be checked', 'local {\n}\n', async () => { throw new Error('unreachable'); }],
    ])('reports a pending local change as unexplained when %s', async (name, onDisk, verifyLive) => {
        await recordLocalChange(alpha, { content: 'local {\n}\n', verification: { file: 'verified', live: 'uncertain' }, verifyLive });
        files.set(alpha.configPath, onDisk);
        live.set(alpha.adminUrl, { apps: { other: true } });
        await checkAllInstances();
        expect(reports()).toHaveLength(1);
    });

    it('defers judgment while a timed-out caddy-ui write is unsettled', async () => {
        await recordLocalChange(alpha, { content: 'local {\n}\n', verification: { file: 'verified', live: 'uncertain' },
            verifyLive: async () => (live.get(alpha.adminUrl).apps.local ? 'verified' : 'mismatch'),
            expectLive: () => ({ apps: { local: true } }) });
        files.set(alpha.configPath, 'local {\n}\n');
        unsettled.add(alpha.adminUrl);
        await checkAllInstances();
        live.set(alpha.adminUrl, { apps: { local: true } });
        unsettled.delete(alpha.adminUrl);
        await checkAllInstances();
        expect(reports()).toHaveLength(0);
    });

    it('logs read failures separately, once per outage, without counting them as changes', async () => {
        files.delete(alpha.configPath);
        await checkAllInstances();
        await checkAllInstances();
        const unavailable = warn.mock.calls.filter(([message]) => message === 'Configuration drift check unavailable');
        expect(unavailable).toHaveLength(1);
        expect(unavailable[0][1]).toMatchObject({ instanceId: 'alpha', error: 'Error EIO' });
        files.set(alpha.configPath, 'alpha.example.com {\n}\n');
        await checkAllInstances();
        expect(info.mock.calls.some(([message]) => message === 'Configuration drift check available again')).toBe(true);
        expect(reports()).toHaveLength(0);
    });

    it('bounds retained changes and drops removed instances', async () => {
        for (let index = 0; index < DRIFT_HISTORY_LIMIT + 5; index++) {
            files.set(alpha.configPath, `change-${index} {\n}\n`);
            await checkAllInstances();
        }
        expect(changes('alpha')).toHaveLength(DRIFT_HISTORY_LIMIT);
        instances.splice(0, instances.length, alpha);
        await checkAllInstances();
        expect(getConfigDriftState('beta')).toBeNull();
    });

    it('never logs configuration text', async () => {
        const secret = 'token-' + crypto.randomUUID();
        files.set(alpha.configPath, `edited {\n\theader X-Secret ${secret}\n}\n`);
        live.set(alpha.adminUrl, { apps: { secret } });
        await checkAllInstances();
        expect(reports()).toHaveLength(1);
        expect(JSON.stringify([...warn.mock.calls, ...info.mock.calls])).not.toContain(secret);
    });

    it('a file-only save keeps unrelated live changes unexplained', async () => {
        live.set(alpha.adminUrl, { apps: { externally_injected: true } });
        files.set(alpha.configPath, 'local {\n}\n');
        await recordLocalChange(alpha, {
            content: 'local {\n}\n', verification: { file: 'verified', live: 'not-applied' },
        });
        await checkAllInstances();
        expect(reports()).toHaveLength(1);
        expect(reports()[0][1].representations).toEqual(['live']);
    });

    it('does not adopt an external file edit that arrives between verification and observation', async () => {
        // Simulate TOCTOU: verifyFile succeeded on 'local', but by the time
        // observe() reads the file, an external edit has landed.
        const { readContainerFile } = await import('../src/containerFs.js');
        const originalImpl = readContainerFile.getMockImplementation();
        let calls = 0;
        readContainerFile.mockImplementation(async (container, path) => {
            calls++;
            // First call from observe() inside recordLocalChange returns the external edit
            if (path === alpha.configPath && calls === 1) return 'external-race {\n}\n';
            return originalImpl(container, path);
        });
        files.set(alpha.configPath, 'external-race {\n}\n');
        live.set(alpha.adminUrl, { apps: { local: true } });
        await recordLocalChange(alpha, {
            content: 'local {\n}\n',
            verification: { file: 'verified', live: 'verified' },
            verifyLive: async () => 'verified',
            expectLive: () => ({ apps: { local: true } }),
        });
        readContainerFile.mockImplementation(originalImpl);
        // The file expectation should be 'local', not 'external-race'
        await checkAllInstances();
        expect(reports()).toHaveLength(1);
        expect(reports()[0][1].representations).toContain('file');
    });
});


// Exercise verification scope independently of file writes and completion time.
const routeCases = ['add', 'replace', 'remove'].flatMap(operation =>
    [false, true].flatMap(diskBacked => ['verified', 'uncertain'].map(status => ({ operation, diskBacked, status }))));
const routeA = { '@id': 'route-a', handle: [{ handler: 'static_response', body: 'original A' }] };
const routeB = { '@id': 'route-b', handle: [{ handler: 'static_response', body: 'original B' }] };
const updatedRoute = operation => ({ '@id': operation === 'add' ? 'route-c' : 'route-a',
    handle: [{ handler: 'static_response', body: 'local edit' }] });
const routesOf = config => config.apps.http.servers.srv0.routes;

async function routeChange({ operation, diskBacked, status }, external = false) {
    resetConfigDrift();
    live.set(alpha.adminUrl, { apps: { http: { servers: { srv0: { routes: structuredClone([routeA, routeB]) } } } } });
    await checkAllInstances();
    const config = structuredClone(live.get(alpha.adminUrl));
    const routes = routesOf(config);
    if (external) routes[1].handle[0].body = 'external edit';
    const route = updatedRoute(operation);
    if (operation === 'add') routes.push(route);
    else if (operation === 'replace') routes[0] = route;
    else routes.splice(0, 1);
    const verifyLive = async () => {
        const actual = routesOf(live.get(alpha.adminUrl)).find(candidate => candidate['@id'] === route['@id']);
        return operation === 'remove' ? (actual ? 'mismatch' : 'verified')
            : (JSON.stringify(actual) === JSON.stringify(route) ? 'verified' : 'mismatch');
    };
    const content = diskBacked ? 'local-file {\n}\n' : null;
    if (diskBacked) files.set(alpha.configPath, content);
    if (status === 'verified') live.set(alpha.adminUrl, config);
    await recordLocalChange(alpha, { content, verification: { file: diskBacked ? 'verified' : 'unchanged', live: status },
        verifyLive, expectLive: routeExpectation({ operation, id: 'route-a', serverName: 'srv0', route }) });
    if (status === 'uncertain') live.set(alpha.adminUrl, config);
    return config;
}

describe('scoped route expectations', () => {
    it.each(routeCases)('accepts only the local $operation (disk=$diskBacked, live=$status) without false drift on later polls', async options => {
        await routeChange(options);
        await checkAllInstances();
        await checkAllInstances();
        expect(reports()).toHaveLength(0);
        expect(changes(alpha.id)).toEqual([]);
    });

    it.each(routeCases)('preserves unrelated live drift after $operation (disk=$diskBacked, live=$status)', async options => {
        const config = await routeChange(options, true);
        await checkAllInstances();
        await checkAllInstances();
        expect(reports()).toHaveLength(1);
        expect(reports()[0][1].representations).toEqual(['live']);
        const [entry] = await history.list(alpha.id);
        const { external } = await history.read(alpha.id, entry.filename);
        const before = JSON.parse(external.before.live), after = JSON.parse(external.after.live);
        expect(routesOf(before).filter(route => route['@id'] !== 'route-b')).toEqual(routesOf(after).filter(route => route['@id'] !== 'route-b'));
        // Reverting only the external edit reaches the projected expectation,
        // even though the legitimate local mutation remains in place.
        const other = routesOf(config).find(route => route['@id'] === 'route-b');
        other.handle[0].body = 'original B';
        await checkAllInstances();
        expect(reports()).toHaveLength(1);
        other.handle[0].body = 'external edit';
        await checkAllInstances();
        expect(reports()).toHaveLength(2);
    });

    it.each(['verified', 'uncertain'])('keeps an external file edit visible while confirming a %s API-only edit', async status => {
        await routeChange({ operation: 'replace', diskBacked: false, status });
        files.set(alpha.configPath, 'externally-edited {\n}\n');
        await checkAllInstances();
        await checkAllInstances();
        expect(reports()).toHaveLength(1);
        expect(reports()[0][1].representations).toEqual(['file']);
    });

    it('does not expose configuration snapshots in diagnostics or logs', async () => {
        const secret = crypto.randomUUID();
        resetConfigDrift();
        live.set(alpha.adminUrl, { apps: { secret } });
        await checkAllInstances();
        files.set(alpha.configPath, 'external {\n}\n');
        await checkAllInstances();
        expect(JSON.stringify(getConfigDriftState(alpha.id))).not.toContain(secret);
        expect(JSON.stringify([...info.mock.calls, ...warn.mock.calls])).not.toContain(secret);
    });
});

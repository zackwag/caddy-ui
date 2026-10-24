import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const { DRIFT_HISTORY_LIMIT, checkAllInstances, getConfigDriftState, recordLocalChange, resetConfigDrift } = await import('../src/configDrift.js');

const alpha = { id: 'alpha', name: 'Alpha', adminUrl: 'http://alpha:2019', configPath: '/alpha/Caddyfile', containerName: 'alpha' };
const beta = { id: 'beta', name: 'Beta', adminUrl: 'http://beta:2019', configPath: '/beta/Caddyfile', containerName: 'beta' };
const verified = { file: 'verified', live: 'verified' };

let warn;
let info;
const reports = () => warn.mock.calls.filter(([message]) => message === 'Configuration changed outside caddy-ui');
const changes = id => getConfigDriftState(id).changes;

beforeEach(async () => {
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
        await recordLocalChange(alpha, { content: 'local {\n}\n', verification: verified, verifyLive: async () => 'verified' });
        await checkAllInstances();
        expect(reports()).toHaveLength(0);
    });

    it('confirms an unverified local change once the running config matches it', async () => {
        files.set(alpha.configPath, 'local {\n}\n');
        await recordLocalChange(alpha, { content: 'local {\n}\n', verification: { file: 'verified', live: 'uncertain' },
            verifyLive: async () => 'verified' });
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
            verifyLive: async () => (live.get(alpha.adminUrl).apps.local ? 'verified' : 'mismatch') });
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
});

import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { serve } from './fixtures/server.mjs';

const { instances, accounts } = vi.hoisted(() => ({ instances: [], accounts: { user: 'administrator' } }));
vi.mock('../src/instances.js', () => ({ getInstances: () => instances }));
vi.mock('../src/middleware/auth.js', () => ({
    getAuthentication: () => ({
        resolveActor: actor => actor.type === 'user' && actor.id === 'account-1' ? { ...actor, name: accounts.user } : null,
    }),
}));
const { serverNamesWrite } = vi.hoisted(() => ({ serverNamesWrite: { fail: false } }));
vi.mock('../src/serverNames.js', () => ({
    getServerNames: () => ({}), getAllServerNames: () => ({}),
    setServerName: async () => { if (serverNamesWrite.fail) throw new Error('disk full'); },
    removeServerName: async () => {},
}));

let directory, server, base, audit;

beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'caddy-ui-audit-'));
    process.env.AUDIT_LOG_PATH = join(directory, 'audit-log.json');
    process.env.NOTIFICATIONS_CONFIG_PATH = join(directory, 'notifications.json');
    audit = await import('../src/auditLog.js');
    await audit.loadAuditLog();
    const { default: servernames } = await import('../src/routes/servernames.js');
    const { default: notifications } = await import('../src/routes/notifications.js');
    const { default: auditRouter } = await import('../src/routes/audit.js');
    server = await serve(app => {
        // Stands in for authMiddleware: nothing in the body can change the actor
        app.use('/api', (req, res, next) => {
            req.actor = { type: 'user', id: 'account-1', name: accounts.user };
            req.instance = instances[0];
            next();
        });
        app.use('/api/server-names', servernames);
        app.use('/api/notifications', notifications);
        app.use('/api/audit', auditRouter);
    });
    base = server.url + '/api';
});

afterAll(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
    delete process.env.AUDIT_LOG_PATH;
    delete process.env.NOTIFICATIONS_CONFIG_PATH;
});

beforeEach(async () => {
    instances.splice(0, instances.length, { id: 'main', name: 'Main' });
    accounts.user = 'administrator';
    serverNamesWrite.fail = false;
});

const request = (path, method, body) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body) });
const events = async () => (await (await fetch(base + '/audit')).json()).events;

describe('administrative action log', () => {
    it('attributes an instance action to the authenticated actor, not submitted names', async () => {
        const response = await request('/server-names/srv0', 'PUT', { name: ' HTTPS Sites ', actor: { type: 'user', id: 'forged', name: 'Someone' } });
        expect(response.status).toBe(200);
        const [event] = await events();
        expect(event).toMatchObject({ action: 'serverName.set', outcome: 'success', resource: 'srv0', details: { name: 'HTTPS Sites' },
            actor: { type: 'user', id: 'account-1', name: 'administrator' }, instance: { id: 'main', name: 'Main' } });
        expect(event.timestamp).toEqual(expect.any(String));
    });

    it('records failed operations as failures', async () => {
        serverNamesWrite.fail = true;
        expect((await request('/server-names/srv1', 'PUT', { name: 'Edge' })).status).toBe(500);
        expect((await events())[0]).toMatchObject({ action: 'serverName.set', resource: 'srv1', outcome: 'failure' });
    });

    it('keeps application-wide actions unassigned and excludes notification destinations and secrets', async () => {
        const secret = 'https://hooks.example.com/' + crypto.randomUUID();
        await request('/notifications/config', 'PUT', { enabled: true, provider: 'discord', discord: { webhookUrl: secret }, triggers: { authentication: true } });
        const [event] = await events();
        expect(event).toMatchObject({ action: 'notifications.configure', instance: null, details: { enabled: true, provider: 'discord' } });
        expect(event.details.triggers).toContain('authentication');
        expect(await readFile(process.env.AUDIT_LOG_PATH, 'utf8')).not.toContain(secret);
    });

    it('shows current account and instance names without rewriting stored events', async () => {
        await request('/server-names/srv0', 'DELETE');
        accounts.user = 'renamed';
        instances[0] = { id: 'main', name: 'Primary' };
        expect((await events())[0]).toMatchObject({ actor: { name: 'renamed' }, instance: { name: 'Primary' } });
        instances.splice(0);
        accounts.user = null;
        const stored = JSON.parse(await readFile(process.env.AUDIT_LOG_PATH, 'utf8')).events.at(-1);
        expect(stored).toMatchObject({ actor: { name: 'administrator' }, instance: { name: 'Main' } });
        expect((await events())[0].instance).toEqual({ id: 'main', name: 'Main' });
    });

    it('keeps the newest events within the retention limit', async () => {
        const stored = Array.from({ length: audit.AUDIT_LOG_LIMIT }, (_, i) => ({ id: `old-${i}`, resource: `old-${i}`, actor: null, instance: null }));
        await writeFile(process.env.AUDIT_LOG_PATH, JSON.stringify({ events: stored }));
        await audit.loadAuditLog();
        await request('/server-names/srv9', 'DELETE');
        const listed = await events();
        expect(listed).toHaveLength(audit.AUDIT_LOG_LIMIT);
        expect(listed[0].resource).toBe('srv9');
        expect(listed.at(-1).resource).toBe('old-1');
    });

    it('reports a completed change as successful when the event cannot be stored', async () => {
        // A directory in place of the file fails the write for any user
        await rename(process.env.AUDIT_LOG_PATH, process.env.AUDIT_LOG_PATH + '.kept');
        await mkdir(process.env.AUDIT_LOG_PATH);
        const response = await request('/server-names/srv0', 'PUT', { name: 'Kept' });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ ok: true, name: 'Kept' });
        expect((await events())[0].details?.name).not.toBe('Kept');
        await rm(process.env.AUDIT_LOG_PATH, { recursive: true });
        await rename(process.env.AUDIT_LOG_PATH + '.kept', process.env.AUDIT_LOG_PATH);
    });
});

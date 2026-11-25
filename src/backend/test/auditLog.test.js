import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { instances, accounts } = vi.hoisted(() => ({ instances: [], accounts: { user: 'administrator' } }));
vi.mock('../src/instances.js', () => ({ getInstances: () => instances }));
// Session identity stands in for the real auth service: an `x-session` header
// marks a management session, and nothing in the body can change the actor.
vi.mock('../src/middleware/auth.js', () => ({
    getAuthentication: () => ({
        getActor: req => req.headers['x-session'] ? { type: 'user', id: 'account-1', name: accounts.user } : null,
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
    const app = express();
    app.use(express.json());
    app.use('/api/server-names', (req, res, next) => { req.instance = instances[0]; next(); }, servernames);
    app.use('/api/notifications', notifications);
    app.use('/api/audit', auditRouter);
    app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}/api`;
});

afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
    delete process.env.AUDIT_LOG_PATH;
    delete process.env.NOTIFICATIONS_CONFIG_PATH;
});

beforeEach(async () => {
    instances.splice(0, instances.length, { id: 'main', name: 'Main' });
    accounts.user = 'administrator';
    serverNamesWrite.fail = false;
    await chmod(directory, 0o700);
});

const request = (path, method, body) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-session': '1' },
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
        for (let i = 0; i < audit.AUDIT_LOG_LIMIT + 5; i++) {
            await audit.recordAudit({ headers: {} }, { action: 'serverName.remove', instanceId: 'main', resource: `srv${i}` });
        }
        const listed = await events();
        expect(listed).toHaveLength(audit.AUDIT_LOG_LIMIT);
        expect(listed[0].resource).toBe(`srv${audit.AUDIT_LOG_LIMIT + 4}`);
        expect(listed[0].actor).toBeNull();
    });

    it('reports a completed change as successful when the event cannot be stored', async () => {
        await chmod(directory, 0o500);
        const response = await request('/server-names/srv0', 'PUT', { name: 'Kept' });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ ok: true, name: 'Kept' });
        expect((await events())[0].details?.name).not.toBe('Kept');
    });

    it('rejects actions outside the agreed list', async () => {
        await audit.recordAudit({ headers: {} }, { action: 'settings.update' });
        expect((await events()).some(event => event.action === 'settings.update')).toBe(false);
    });
});

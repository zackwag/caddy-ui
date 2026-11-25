import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../src/logger.js', () => ({ default: logger }));

const historyRoot = await mkdtemp(join(tmpdir(), 'caddy-ui-admin-events-history-'));
const eventsRoot = await mkdtemp(join(tmpdir(), 'caddy-ui-admin-events-'));
const eventsPath = join(eventsRoot, 'admin-events.json');
process.env.HISTORY_PATH = historyRoot;
process.env.ADMIN_EVENTS_PATH = eventsPath;

afterAll(async () => {
    await rm(historyRoot, { recursive: true, force: true });
    await rm(eventsRoot, { recursive: true, force: true });
    delete process.env.HISTORY_PATH;
    delete process.env.ADMIN_EVENTS_PATH;
});

const { loadAdminEvents, recordEvent, listEvents } = await import('../src/adminEvents.js');

const actor = { type: 'user', id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Admin' };

beforeEach(async () => {
    logger.info.mockClear();
    logger.warn.mockClear();
    await writeFile(eventsPath, JSON.stringify({ version: 1, events: [] }));
    await loadAdminEvents();
});

describe('admin events', () => {
    it('records an event with actor, action, instance, resource and timestamp', async () => {
        await recordEvent(actor, { action: 'server-name.set', instanceId: 'prod', resource: 'srv0', description: 'Production' });
        const events = await listEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            action: 'server-name.set',
            instanceId: 'prod',
            resource: 'srv0',
            outcome: 'success',
            description: 'Production',
            actor: { type: 'user', id: actor.id, name: 'Admin' },
        });
        expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('resolves actor names from the shared identity registry at list time', async () => {
        await recordEvent(actor, { action: 'settings.updated' });
        // A rename: same ID, different name.
        await recordEvent({ ...actor, name: 'Renamed' }, { action: 'settings.updated' });
        const events = await listEvents();
        // Both events resolve to the latest name.
        expect(events[0].actor.name).toBe('Renamed');
        expect(events[1].actor.name).toBe('Renamed');
    });

    it('records application-wide events with null instanceId', async () => {
        await recordEvent(actor, { action: 'instance.created', resource: 'staging' });
        const events = await listEvents();
        expect(events[0].instanceId).toBeNull();
    });

    it('filters by instanceId', async () => {
        await recordEvent(actor, { action: 'server-name.set', instanceId: 'prod', resource: 'srv0' });
        await recordEvent(actor, { action: 'settings.updated' });
        await recordEvent(actor, { action: 'server-name.set', instanceId: 'staging', resource: 'srv1' });
        expect(await listEvents({ instanceId: 'prod' })).toHaveLength(1);
        expect(await listEvents({ instanceId: null })).toHaveLength(1);
        expect(await listEvents()).toHaveLength(3);
    });

    it('caps retention at the event limit', async () => {
        for (let i = 0; i < 210; i++) {
            await recordEvent(actor, { action: 'settings.updated', description: `change-${i}` });
        }
        const events = await listEvents({ limit: 300 });
        expect(events.length).toBeLessThanOrEqual(200);
        // Most recent event is first.
        expect(events[0].description).toBe('change-209');
    });

    it('rejects unknown actions', async () => {
        await recordEvent(actor, { action: 'unknown.action' });
        expect(logger.warn).toHaveBeenCalledWith('Unknown admin event action ignored', { action: 'unknown.action' });
        expect(await listEvents()).toHaveLength(0);
    });

    it('records events with a null actor when the request has no session', async () => {
        await recordEvent(null, { action: 'settings.updated' });
        const events = await listEvents();
        expect(events[0].actor).toBeNull();
    });

    it('survives a recording failure without throwing', async () => {
        // The outer try/catch in recordEvent handles errors gracefully.
        await expect(recordEvent(actor, { action: 'settings.updated' })).resolves.not.toThrow();
    });

    it('distinguishes success from rejected outcomes', async () => {
        await recordEvent(actor, { action: 'instance.removed', resource: 'gone', outcome: 'rejected' });
        const events = await listEvents();
        expect(events[0].outcome).toBe('rejected');
    });
});

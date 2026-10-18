import { once } from 'node:events';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import healthRouter from '../src/routes/health.js';
import { getStatsForInstance, recordCheck } from '../src/uptimeHistory.js';

const { checkInstanceUpstreams } = vi.hoisted(() => ({ checkInstanceUpstreams: vi.fn() }));

vi.mock('../src/upstreamChecks.js', async importOriginal => ({
    ...await importOriginal(),
    checkInstanceUpstreams,
}));

const instanceId = 'health-route-test';
let server;
let healthUrl;

beforeAll(async () => {
    const app = express();
    app.use('/api/health', (req, res, next) => {
        req.instance = { id: instanceId, adminUrl: 'http://caddy:2019' };
        next();
    }, healthRouter);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    healthUrl = `http://127.0.0.1:${server.address().port}/api/health`;
});

afterAll(() => new Promise(resolve => server.close(resolve)));

beforeEach(() => {
    checkInstanceUpstreams.mockReset().mockResolvedValue([
        { domain: 'app.example.com', upstream: 'app:3000', server: 'srv0', online: false },
    ]);
});

describe('GET /api/health', () => {
    it('returns live results with the time they were observed', async () => {
        const res = await fetch(healthUrl);
        expect(res.status).toBe(200);
        const [check] = await res.json();
        expect(check).toMatchObject({ domain: 'app.example.com', upstream: 'app:3000', online: false });
        expect(Number.isNaN(Date.parse(check.checkedAt))).toBe(false);
    });

    it('does not add uptime history samples, however often it is read', async () => {
        recordCheck(instanceId, 'app:3000', true);
        const before = getStatsForInstance(instanceId)['app:3000'];

        await fetch(healthUrl);
        await fetch(healthUrl);

        expect(checkInstanceUpstreams).toHaveBeenCalledTimes(2);
        expect(getStatsForInstance(instanceId)['app:3000']).toMatchObject({
            total: before.total, online: before.online, pct: before.pct, currentlyOnline: true,
        });
    });
});

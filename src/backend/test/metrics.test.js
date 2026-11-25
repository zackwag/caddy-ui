import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { buildRawMetrics, formatUptimeMetrics } from '../src/uptimeMetrics.js';
import { rawMetrics } from '../src/routes/metrics.js';
import * as instances from '../src/instances.js';
import { recordCheck } from '../src/uptimeHistory.js';
import { serve } from './fixtures/server.mjs';

describe('GET /api/metrics/raw', () => {
    let server;
    beforeAll(async () => {
        server = await serve(app => app.get('/raw', (req, res, next) => {
            // Nothing listens there, so only the uptime series are served
            req.instance = { id: 'allowed', adminUrl: 'http://127.0.0.1:1' };
            if (req.query.token) req.apiToken = { instanceIds: ['allowed'] };
            next();
        }, rawMetrics));
        vi.spyOn(instances, 'getInstances').mockReturnValue([{ id: 'allowed', name: 'Allowed' }, { id: 'private', name: 'Private' }]);
        for (const id of ['allowed', 'private']) recordCheck(id, 'app:80', true);
    });
    afterAll(() => server.close());
    afterEach(() => vi.clearAllMocks());

    const scrape = async query => (await fetch(`${server.url}/raw${query}`)).text();

    it('serves every instance to an administrator', async () => {
        const text = await scrape('');
        expect(text).toContain('instance_id="allowed"');
        expect(text).toContain('instance_id="private"');
        expect(text).toContain('caddy_ui_caddy_metrics_up{instance_id="allowed"} 0');
    });

    it('limits an API token to its instances', async () => {
        const text = await scrape('?token=1');
        expect(text).toContain('caddy_ui_upstream_up{instance_id="allowed"');
        expect(text).not.toMatch(/private/i);
    });
});

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

function stats(overrides = {}) {
    return {
        pct: 75, total: 4, online: 3, currentlyOnline: true,
        streakSeconds: 60,
        firstSeen: new Date(NOW - 3600_000), lastCheckAt: new Date(NOW - 10_000),
        ...overrides,
    };
}

describe('formatUptimeMetrics', () => {
    it('emits HELP/TYPE headers and one sample per family per upstream', () => {
        const out = formatUptimeMetrics([{ id: 'default', name: 'Home', stats: { upstream: { '10.0.0.5:8080': stats() } } }], NOW);
        const labels = 'instance_id="default",instance_name="Home",upstream="10.0.0.5:8080"';
        expect(out).toContain('# TYPE caddy_ui_upstream_up gauge\n');
        expect(out).toContain(`caddy_ui_upstream_up{${labels}} 1\n`);
        expect(out).toContain(`caddy_ui_upstream_uptime_ratio{${labels}} 0.75\n`);
        expect(out).toContain(`caddy_ui_upstream_state_duration_seconds{${labels}} 60\n`);
    });

    it('reports 0 for an upstream that is currently offline', () => {
        const out = formatUptimeMetrics([{ id: 'a', name: 'A', stats: { upstream: { 'x:1': stats({ currentlyOnline: false }) } } }], NOW);
        expect(out).toMatch(/caddy_ui_upstream_up\{[^}]+\} 0\n/);
    });

    it('covers every instance passed in', () => {
        const out = formatUptimeMetrics([
            { id: 'a', name: 'A', stats: { upstream: { 'x:1': stats() } } },
            { id: 'b', name: 'B', stats: { upstream: { 'x:1': stats() } } },
        ], NOW);
        expect(out).toContain('caddy_ui_upstream_up{instance_id="a",instance_name="A",upstream="x:1"} 1');
        expect(out).toContain('caddy_ui_upstream_up{instance_id="b",instance_name="B",upstream="x:1"} 1');
    });

    it('skips null stats and upstreams whose last check is stale', () => {
        const out = formatUptimeMetrics([{
            id: 'a', name: 'A', stats: { upstream: {
                'empty:1': null,
                'gone:1': stats({ lastCheckAt: new Date(NOW - 10 * 60_000) }),
            } },
        }], NOW);
        expect(out).not.toContain('empty:1');
        expect(out).not.toContain('gone:1');
        expect(out).toContain('# TYPE caddy_ui_upstream_uptime_ratio gauge');
    });

    it('emits route series labeled by host', () => {
        const out = formatUptimeMetrics([{ id: 'default', name: 'Home', stats: { route: { 'files.example.com': stats({ currentlyOnline: false }) } } }], NOW);
        const labels = 'instance_id="default",instance_name="Home",route="files.example.com"';
        expect(out).toContain('# TYPE caddy_ui_route_up gauge\n');
        expect(out).toContain(`caddy_ui_route_up{${labels}} 0\n`);
        expect(out).toContain(`caddy_ui_route_uptime_ratio{${labels}} 0.75\n`);
        expect(out).toContain(`caddy_ui_route_state_duration_seconds{${labels}} 60\n`);
    });

    it('keeps route series through one missed 5 minute check but drops them after that', () => {
        const out = formatUptimeMetrics([{
            id: 'a', name: 'A', stats: { route: {
                'recent.example.com': stats({ lastCheckAt: new Date(NOW - 7 * 60_000) }),
                'gone.example.com': stats({ lastCheckAt: new Date(NOW - 13 * 60_000) }),
            } },
        }], NOW);
        expect(out).toContain('route="recent.example.com"');
        expect(out).not.toContain('gone.example.com');
    });

    it('declares route families even without route checks', () => {
        const out = formatUptimeMetrics([{ id: 'a', name: 'A', stats: { upstream: { 'x:1': stats() } } }], NOW);
        expect(out).toContain('# TYPE caddy_ui_route_up gauge\n');
        expect(out).not.toContain('caddy_ui_route_up{');
    });

    it('escapes quotes, backslashes, and newlines in label values', () => {
        const out = formatUptimeMetrics([{ id: 'a', name: 'My "lab"\\box\nx', stats: { upstream: { 'x:1': stats() } } }], NOW);
        expect(out).toContain('instance_name="My \\"lab\\"\\\\box\\nx"');
    });
});

describe('buildRawMetrics', () => {
    const uptimeInstances = [{ id: 'default', name: 'Home', stats: { upstream: { 'x:1': stats() } } }];

    it('passes Caddy metrics through and appends uptime series', () => {
        const caddyText = '# TYPE caddy_up gauge\ncaddy_up 1\n';
        const out = buildRawMetrics({ instanceId: 'default', caddyText, caddyError: null, uptimeInstances, now: NOW });
        expect(out.startsWith(caddyText)).toBe(true);
        expect(out).toContain('caddy_ui_caddy_metrics_up{instance_id="default"} 1\n');
        expect(out).toContain('caddy_ui_upstream_up{');
    });

    it('adds a trailing newline to Caddy output that lacks one', () => {
        const out = buildRawMetrics({ instanceId: 'default', caddyText: 'caddy_up 1', caddyError: null, uptimeInstances: [], now: NOW });
        expect(out.startsWith('caddy_up 1\n# HELP')).toBe(true);
    });

    it('still serves uptime when Caddy metrics are unavailable', () => {
        const out = buildRawMetrics({ instanceId: 'default', caddyText: '', caddyError: 'Metrics unavailable:\n404', uptimeInstances, now: NOW });
        expect(out.startsWith('# Caddy metrics unavailable: Metrics unavailable: 404\n')).toBe(true);
        expect(out).toContain('caddy_ui_caddy_metrics_up{instance_id="default"} 0\n');
        expect(out).toContain('caddy_ui_upstream_up{');
    });
});

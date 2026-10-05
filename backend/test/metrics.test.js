import { describe, expect, it } from 'vitest';
import { buildRawMetrics, formatUptimeMetrics } from '../src/routes/metrics.js';

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

function stats(overrides = {}) {
    return {
        pct: 75, total: 4, online: 3, currentlyOnline: true,
        streak: 2, streakSeconds: 60, streakLabel: '1m',
        firstSeen: new Date(NOW - 3600_000), lastCheckAt: new Date(NOW - 10_000),
        ...overrides,
    };
}

describe('formatUptimeMetrics', () => {
    it('emits HELP/TYPE headers and one sample per family per upstream', () => {
        const out = formatUptimeMetrics([{ id: 'default', name: 'Home', stats: { '10.0.0.5:8080': stats() } }], NOW);
        const labels = 'instance_id="default",instance_name="Home",upstream="10.0.0.5:8080"';
        expect(out).toContain('# TYPE caddy_ui_upstream_up gauge\n');
        expect(out).toContain(`caddy_ui_upstream_up{${labels}} 1\n`);
        expect(out).toContain(`caddy_ui_upstream_uptime_ratio{${labels}} 0.75\n`);
        expect(out).toContain(`caddy_ui_upstream_state_duration_seconds{${labels}} 60\n`);
    });

    it('reports 0 for an upstream that is currently offline', () => {
        const out = formatUptimeMetrics([{ id: 'a', name: 'A', stats: { 'x:1': stats({ currentlyOnline: false }) } }], NOW);
        expect(out).toMatch(/caddy_ui_upstream_up\{[^}]+\} 0\n/);
    });

    it('covers every instance passed in', () => {
        const out = formatUptimeMetrics([
            { id: 'a', name: 'A', stats: { 'x:1': stats() } },
            { id: 'b', name: 'B', stats: { 'x:1': stats() } },
        ], NOW);
        expect(out).toContain('caddy_ui_upstream_up{instance_id="a",instance_name="A",upstream="x:1"} 1');
        expect(out).toContain('caddy_ui_upstream_up{instance_id="b",instance_name="B",upstream="x:1"} 1');
    });

    it('skips null stats and upstreams whose last check is stale', () => {
        const out = formatUptimeMetrics([{
            id: 'a', name: 'A', stats: {
                'empty:1': null,
                'gone:1': stats({ lastCheckAt: new Date(NOW - 10 * 60_000) }),
            },
        }], NOW);
        expect(out).not.toContain('empty:1');
        expect(out).not.toContain('gone:1');
        // Headers still present so the families are declared even when empty
        expect(out).toContain('# TYPE caddy_ui_upstream_uptime_ratio gauge');
    });

    it('escapes quotes, backslashes, and newlines in label values', () => {
        const out = formatUptimeMetrics([{ id: 'a', name: 'My "lab"\\box\nx', stats: { 'x:1': stats() } }], NOW);
        expect(out).toContain('instance_name="My \\"lab\\"\\\\box\\nx"');
    });
});

describe('buildRawMetrics', () => {
    const uptimeInstances = [{ id: 'default', name: 'Home', stats: { 'x:1': stats() } }];

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

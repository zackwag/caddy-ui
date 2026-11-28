import { describe, expect, it } from 'vitest';
import { formatUptime, summarizeProcess, summarizeRequests } from '../src/caddyMetrics.js';
import { parseMetrics } from '../src/prometheus.js';

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const startedAgo = seconds => `process_start_time_seconds ${NOW / 1000 - seconds}\n`;
const series = (suffix, labels, value) => `caddy_http_request_duration_seconds_${suffix}{handler="subroute",server="srv0",${labels}} ${value}\n`;

describe('summarizeRequests', () => {
    const summarize = text => summarizeRequests(parseMetrics(text), NOW);

    it('totals requests across status codes, methods and hosts', () => {
        const summary = summarize(startedAgo(100)
            + series('count', 'code="200",method="GET",host="a.example"', 6) + series('sum', 'code="200",method="GET",host="a.example"', 0.6)
            + series('count', 'code="200",method="GET",host="b.example"', 2) + series('sum', 'code="200",method="GET",host="b.example"', 0.2)
            + series('count', 'code="404",method="GET"', 1) + series('sum', 'code="404",method="GET"', 0.1)
            + series('count', 'code="502",method="POST"', 1) + series('sum', 'code="502",method="POST"', 0.1));
        expect(summary).toMatchObject({
            totalRequests: 10, statusGroups: { '2xx': 8, '3xx': 0, '4xx': 1, '5xx': 1 }, avgResponseMs: 100, rps: 0.1, uptimeSeconds: 100,
        });
    });

    it('counts a request once although every handler it passes through reports it', () => {
        expect(summarize(series('count', 'code="200"', 3) + 'caddy_http_request_duration_seconds_count{handler="reverse_proxy",code="200"} 3\n').totalRequests).toBe(3);
    });

    it('interpolates percentiles within the bucket they fall in', () => {
        const buckets = counts => Object.entries(counts).map(([le, value]) => series('bucket', `code="200",le="${le}"`, value)).join('');
        expect(summarize(buckets({ '0.1': 50, '0.2': 90, '0.4': 100, '+Inf': 100 }))).toMatchObject({ p50: 100, p95: 300, p99: 380 });
        // Slower than the largest finite bucket can tell
        expect(summarize(buckets({ '0.1': 1, '10': 1, '+Inf': 100 }))).toMatchObject({ p50: 10000, p99: 10000 });
    });

    it('reports zeros and no rate before any request or start time', () => {
        expect(summarize('')).toEqual({
            totalRequests: 0, statusGroups: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }, avgResponseMs: 0, p50: 0, p95: 0, p99: 0, rps: null, uptimeSeconds: null,
        });
    });
});

describe('summarizeProcess', () => {
    it('reports memory in megabytes and when the config was last loaded', () => {
        const text = startedAgo(3725) + `go_memstats_alloc_bytes 1.2582912e+07
go_memstats_sys_bytes 2.62144e+07
caddy_config_last_reload_success_timestamp_seconds ${NOW / 1000}
caddy_config_last_reload_successful 1
`;
        expect(summarizeProcess(parseMetrics(text), NOW)).toEqual({
            uptime: '1h 2m', uptimeSeconds: 3725, memAlloc: 12, memSys: 25, lastReload: '2026-01-01T12:00:00.000Z', lastReloadSuccess: true,
        });
    });

    it('leaves out what the metrics do not say', () => {
        expect(summarizeProcess([], NOW)).toEqual({ uptime: null, uptimeSeconds: null, memAlloc: null, memSys: null, lastReload: null, lastReloadSuccess: false });
    });
});

it.each([[0, '0s'], [45, '45s'], [125, '2m'], [3600, '1h 0m'], [3725, '1h 2m'], [86400, '1d 0h 0m'], [90061, '1d 1h 1m']])('formats %s seconds of uptime as %s', (seconds, expected) => {
    expect(formatUptime(seconds)).toBe(expected);
});

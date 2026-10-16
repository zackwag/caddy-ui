import { describe, expect, it } from 'vitest';
import { formatUptime, parsePrometheusMetrics } from '../src/routes/status.js';

describe('parsePrometheusMetrics', () => {
    it('parses simple key-value metrics', () => {
        const text = `process_start_time_seconds 1700000000
go_memstats_alloc_bytes 12345678`;
        const result = parsePrometheusMetrics(text);
        expect(result['process_start_time_seconds']).toBe(1700000000);
        expect(result['go_memstats_alloc_bytes']).toBe(12345678);
    });

    it('skips comment lines', () => {
        const text = `# HELP process_start_time_seconds Start time
# TYPE process_start_time_seconds gauge
process_start_time_seconds 1700000000`;
        const result = parsePrometheusMetrics(text);
        expect(Object.keys(result)).toHaveLength(1);
        expect(result['process_start_time_seconds']).toBe(1700000000);
    });

    it('skips empty lines', () => {
        const text = `metric_a 1

metric_b 2
`;
        const result = parsePrometheusMetrics(text);
        expect(result['metric_a']).toBe(1);
        expect(result['metric_b']).toBe(2);
    });

    it('handles labeled metrics', () => {
        const text = `caddy_http_request_duration_seconds_bucket{code="200",handler="subroute",le="0.005"} 42`;
        const result = parsePrometheusMetrics(text);
        expect(result['caddy_http_request_duration_seconds_bucket{code="200",handler="subroute",le="0.005"}']).toBe(42);
    });

    it('handles scientific notation', () => {
        const text = `metric_a 1.5e+3`;
        const result = parsePrometheusMetrics(text);
        expect(result['metric_a']).toBe(1500);
    });

    it('returns empty object for empty input', () => {
        expect(parsePrometheusMetrics('')).toEqual({});
    });

    it('returns empty object for only comments', () => {
        expect(parsePrometheusMetrics('# just comments\n# more comments')).toEqual({});
    });

    it('handles float values', () => {
        const result = parsePrometheusMetrics('metric_a 3.14159');
        expect(result['metric_a']).toBeCloseTo(3.14159);
    });
});

describe('formatUptime', () => {
    it('formats seconds only', () => {
        expect(formatUptime(45)).toBe('45s');
    });

    it('formats minutes and seconds', () => {
        expect(formatUptime(125)).toBe('2m');
    });

    it('formats hours and minutes', () => {
        expect(formatUptime(3725)).toBe('1h 2m');
    });

    it('formats days, hours, and minutes', () => {
        expect(formatUptime(90061)).toBe('1d 1h 1m');
    });

    it('formats zero seconds', () => {
        expect(formatUptime(0)).toBe('0s');
    });

    it('formats exactly one day', () => {
        expect(formatUptime(86400)).toBe('1d 0h 0m');
    });

    it('formats exactly one hour', () => {
        expect(formatUptime(3600)).toBe('1h 0m');
    });

    it('formats exactly one minute', () => {
        expect(formatUptime(60)).toBe('1m');
    });
});

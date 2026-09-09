import { beforeEach, describe, expect, it } from 'vitest';
import { extractUpstreams, formatDuration, getHost, getUptimeStats, recordCheck } from '../src/routes/health.js';

describe('extractUpstreams', () => {
    it('extracts dial addresses from reverse_proxy handlers', () => {
        const route = {
            handle: [{
                handler: 'reverse_proxy',
                upstreams: [{ dial: 'localhost:8080' }],
            }],
        };
        expect(extractUpstreams(route)).toEqual(['localhost:8080']);
    });

    it('extracts from nested subroute handlers', () => {
        const route = {
            handle: [{
                handler: 'subroute',
                routes: [{
                    handle: [{
                        handler: 'reverse_proxy',
                        upstreams: [{ dial: 'app:3000' }],
                    }],
                }],
            }],
        };
        expect(extractUpstreams(route)).toEqual(['app:3000']);
    });

    it('extracts multiple upstreams', () => {
        const route = {
            handle: [{
                handler: 'reverse_proxy',
                upstreams: [
                    { dial: 'app1:3000' },
                    { dial: 'app2:3001' },
                ],
            }],
        };
        expect(extractUpstreams(route)).toEqual(['app1:3000', 'app2:3001']);
    });

    it('returns empty array for non-proxy handlers', () => {
        const route = {
            handle: [{ handler: 'file_server' }],
        };
        expect(extractUpstreams(route)).toEqual([]);
    });

    it('returns empty array for missing handle', () => {
        expect(extractUpstreams({})).toEqual([]);
    });

    it('skips upstreams without dial', () => {
        const route = {
            handle: [{
                handler: 'reverse_proxy',
                upstreams: [{ dial: 'app:3000' }, {}],
            }],
        };
        expect(extractUpstreams(route)).toEqual(['app:3000']);
    });
});

describe('getHost', () => {
    it('returns the first host from match', () => {
        const route = { match: [{ host: ['app.example.com'] }] };
        expect(getHost(route)).toBe('app.example.com');
    });

    it('returns null when no host matcher', () => {
        const route = { match: [{ path: ['/api/*'] }] };
        expect(getHost(route)).toBeNull();
    });

    it('returns null when no match', () => {
        expect(getHost({})).toBeNull();
    });
});

describe('formatDuration', () => {
    it('formats seconds only', () => {
        expect(formatDuration(30)).toBe('30s');
    });

    it('formats minutes', () => {
        expect(formatDuration(120)).toBe('2m');
    });

    it('formats hours and minutes', () => {
        expect(formatDuration(3660)).toBe('1h 1m');
    });

    it('formats days and hours', () => {
        expect(formatDuration(90000)).toBe('1d 1h');
    });

    it('formats zero', () => {
        expect(formatDuration(0)).toBe('0s');
    });
});

describe('recordCheck / getUptimeStats', () => {
    beforeEach(() => {
        // Record a unique upstream per test to avoid state leaking
    });

    it('returns null for unknown upstream', () => {
        expect(getUptimeStats('never-seen:1234')).toBeNull();
    });

    it('tracks online checks correctly', () => {
        const key = `test-online-${Date.now()}`;
        recordCheck(key, true);
        recordCheck(key, true);
        recordCheck(key, true);
        const stats = getUptimeStats(key);
        expect(stats.pct).toBe(100);
        expect(stats.total).toBe(3);
        expect(stats.online).toBe(3);
        expect(stats.currentlyOnline).toBe(true);
        expect(stats.streak).toBe(3);
    });

    it('tracks mixed checks correctly', () => {
        const key = `test-mixed-${Date.now()}`;
        recordCheck(key, true);
        recordCheck(key, false);
        recordCheck(key, false);
        const stats = getUptimeStats(key);
        expect(stats.pct).toBeCloseTo(33.3, 0);
        expect(stats.total).toBe(3);
        expect(stats.online).toBe(1);
        expect(stats.currentlyOnline).toBe(false);
        expect(stats.streak).toBe(2);
    });

    it('computes streak from end of results', () => {
        const key = `test-streak-${Date.now()}`;
        recordCheck(key, false);
        recordCheck(key, false);
        recordCheck(key, true);
        recordCheck(key, true);
        recordCheck(key, true);
        const stats = getUptimeStats(key);
        expect(stats.streak).toBe(3);
        expect(stats.currentlyOnline).toBe(true);
    });

    it('includes a streakLabel', () => {
        const key = `test-label-${Date.now()}`;
        recordCheck(key, true);
        const stats = getUptimeStats(key);
        expect(stats.streakLabel).toBe('30s');
    });

    it('includes firstSeen date', () => {
        const key = `test-firstseen-${Date.now()}`;
        recordCheck(key, true);
        const stats = getUptimeStats(key);
        expect(stats.firstSeen).toBeInstanceOf(Date);
    });
});

import { describe, expect, it } from 'vitest';
import { formatDuration, getHistory, getStatsForInstance, getUptimeStats, recordCheck } from '../src/uptimeHistory.js';

const INSTANCE = 'test-instance';

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
    it('returns null for an unknown upstream', () => {
        expect(getUptimeStats(INSTANCE, 'never-seen:1234')).toBeNull();
    });

    it('tracks online checks correctly', () => {
        const key = `test-online-${Date.now()}`;
        recordCheck(INSTANCE, key, true);
        recordCheck(INSTANCE, key, true);
        recordCheck(INSTANCE, key, true);
        const stats = getUptimeStats(INSTANCE, key);
        expect(stats.pct).toBe(100);
        expect(stats.total).toBe(3);
        expect(stats.online).toBe(3);
        expect(stats.currentlyOnline).toBe(true);
        expect(stats.streak).toBe(3);
    });

    it('tracks mixed checks correctly', () => {
        const key = `test-mixed-${Date.now()}`;
        recordCheck(INSTANCE, key, true);
        recordCheck(INSTANCE, key, false);
        recordCheck(INSTANCE, key, false);
        const stats = getUptimeStats(INSTANCE, key);
        expect(stats.pct).toBeCloseTo(33.3, 0);
        expect(stats.total).toBe(3);
        expect(stats.online).toBe(1);
        expect(stats.currentlyOnline).toBe(false);
        expect(stats.streak).toBe(2);
    });

    it('computes streak from end of results', () => {
        const key = `test-streak-${Date.now()}`;
        recordCheck(INSTANCE, key, false);
        recordCheck(INSTANCE, key, false);
        recordCheck(INSTANCE, key, true);
        recordCheck(INSTANCE, key, true);
        recordCheck(INSTANCE, key, true);
        const stats = getUptimeStats(INSTANCE, key);
        expect(stats.streak).toBe(3);
        expect(stats.currentlyOnline).toBe(true);
    });

    it('includes a streakLabel derived from real elapsed time', () => {
        const key = `test-label-${Date.now()}`;
        recordCheck(INSTANCE, key, true);
        const stats = getUptimeStats(INSTANCE, key);
        expect(stats.streakLabel).toBe('0s');
        expect(stats.streakSeconds).toBeGreaterThanOrEqual(0);
    });

    it('includes firstSeen date', () => {
        const key = `test-firstseen-${Date.now()}`;
        recordCheck(INSTANCE, key, true);
        const stats = getUptimeStats(INSTANCE, key);
        expect(stats.firstSeen).toBeInstanceOf(Date);
    });

    it('keeps the same upstream separate across instances', () => {
        const upstream = `shared-upstream-${Date.now()}`;
        recordCheck('instance-a', upstream, true);
        recordCheck('instance-b', upstream, false);
        expect(getUptimeStats('instance-a', upstream).currentlyOnline).toBe(true);
        expect(getUptimeStats('instance-b', upstream).currentlyOnline).toBe(false);
    });
});

describe('getStatsForInstance', () => {
    it('returns stats for every upstream on that instance, keyed by bare upstream', () => {
        const instance = `scoped-${Date.now()}`;
        recordCheck(instance, 'app1:3000', true);
        recordCheck(instance, 'app2:3001', false);
        recordCheck('other-instance', 'app3:3002', true);

        const stats = getStatsForInstance(instance);
        expect(Object.keys(stats).sort()).toEqual(['app1:3000', 'app2:3001']);
        expect(stats['app1:3000'].currentlyOnline).toBe(true);
        expect(stats['app2:3001'].currentlyOnline).toBe(false);
    });
});

describe('getHistory', () => {
    it('returns raw timestamped entries for an upstream', () => {
        const key = `test-history-${Date.now()}`;
        recordCheck(INSTANCE, key, true);
        recordCheck(INSTANCE, key, false);
        const { entries, firstSeen } = getHistory(INSTANCE, key);
        expect(entries).toHaveLength(2);
        expect(entries[0]).toHaveProperty('online', true);
        expect(entries[0]).toHaveProperty('at');
        expect(entries[1]).toHaveProperty('online', false);
        expect(typeof firstSeen).toBe('number');
    });

    it('returns an empty timeline for an unknown upstream', () => {
        expect(getHistory(INSTANCE, 'never-seen:5678')).toEqual({ entries: [], firstSeen: null });
    });

    it('filters entries to those at or after sinceMs', () => {
        const key = `test-since-${Date.now()}`;
        recordCheck(INSTANCE, key, true);
        recordCheck(INSTANCE, key, false);

        expect(getHistory(INSTANCE, key, { sinceMs: 0 }).entries).toHaveLength(2);
        expect(getHistory(INSTANCE, key, { sinceMs: Date.now() + 60_000 }).entries).toHaveLength(0);
    });
});

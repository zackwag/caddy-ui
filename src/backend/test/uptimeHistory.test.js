import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetInstanceHistory, getHistory, getStatsForInstance, recordCheck } from '../src/uptimeHistory.js';

const START = Date.UTC(2026, 0, 1, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const INSTANCE = 'test-instance';
const at = seconds => START + seconds * 1000;

// Checks every 30 seconds from START; leaves the clock at the last one.
function record(target, results, { instance = INSTANCE, kind } = {}) {
    results.forEach((online, i) => {
        vi.setSystemTime(at(i * 30));
        recordCheck(instance, target, online, kind);
    });
}
const stats = (target, kind, instance = INSTANCE) => getStatsForInstance(instance, kind)[target];

beforeEach(() => vi.useFakeTimers({ now: START }));
afterEach(() => {
    for (const id of [INSTANCE, 'other']) {
        forgetInstanceHistory(id);
    }
    vi.useRealTimers();
});

describe('uptime statistics', () => {
    it('are missing for a target never checked', () => {
        expect(stats('never:1')).toBeUndefined();
    });

    it('summarize every check', () => {
        record('app:80', [true, false, false]);
        expect(stats('app:80')).toMatchObject({
            pct: 33.3, total: 3, online: 1, currentlyOnline: false,
            firstSeen: new Date(START), lastCheckAt: new Date(at(60)),
        });
    });

    it('measure the current state from the first check that showed it', () => {
        record('app:80', [true, false, true, true, true]);
        expect(stats('app:80')).toMatchObject({ currentlyOnline: true, streakSeconds: 60 });
        vi.setSystemTime(at(150));
        expect(stats('app:80').streakSeconds).toBe(90);
    });

    it('measure a state that never changed from the first check', () => {
        record('app:80', [true, true, true]);
        expect(stats('app:80').streakSeconds).toBe(60);
    });

    it('drop checks past the retention period but remember when a target was first seen', () => {
        record('app:80', [false]);
        vi.setSystemTime(START + 8 * DAY_MS);
        recordCheck(INSTANCE, 'app:80', true);
        expect(stats('app:80')).toMatchObject({ total: 1, pct: 100, firstSeen: new Date(START) });
    });

    it('keep instances and kinds of check apart', () => {
        record('app.example', [true]);
        record('app.example', [false], { instance: 'other' });
        record('app.example', [false], { kind: 'route' });
        record('files.example', [true], { kind: 'route' });
        expect(stats('app.example').currentlyOnline).toBe(true);
        expect(stats('app.example', 'upstream', 'other').currentlyOnline).toBe(false);
        expect(Object.keys(getStatsForInstance(INSTANCE))).toEqual(['app.example']);
        expect(Object.keys(getStatsForInstance(INSTANCE, 'route')).sort()).toEqual(['app.example', 'files.example']);
    });

    it('are forgotten with their instance', () => {
        record('app.example', [true]);
        record('app.example', [true], { kind: 'route' });
        record('app.example', [true], { instance: 'other' });
        forgetInstanceHistory(INSTANCE);
        expect(getStatsForInstance(INSTANCE)).toEqual({});
        expect(getStatsForInstance(INSTANCE, 'route')).toEqual({});
        expect(Object.keys(getStatsForInstance('other'))).toEqual(['app.example']);
    });
});

describe('check history', () => {
    it('is empty for a target never checked', () => {
        expect(getHistory(INSTANCE, 'never:1')).toEqual({ entries: [], firstSeen: null });
    });

    it('lists checks of one kind, oldest first', () => {
        record('app.example', [true, false]);
        record('app.example', [true], { kind: 'route' });
        expect(getHistory(INSTANCE, 'app.example')).toEqual({
            entries: [{ online: true, at: START }, { online: false, at: at(30) }], firstSeen: START,
        });
        expect(getHistory(INSTANCE, 'app.example', { kind: 'route' }).entries).toHaveLength(1);
    });

    it('starts at the requested time, inclusive', () => {
        record('app:80', [true, true, false]);
        expect(getHistory(INSTANCE, 'app:80', { sinceMs: at(30) }).entries.map(entry => entry.at)).toEqual([at(30), at(60)]);
    });
});

import { describe, expect, it } from 'vitest';
import { summarizeHistory } from '../src/utils/uptimeHistory.js';

describe('uptime incident history', () => {
    it('retains brief incidents, recovery boundaries and check-based availability', () => {
        const history = summarizeHistory([
            { at: 0, online: true }, { at: 100, online: false },
            { at: 127, online: true }, { at: 200, online: false }, { at: 227, online: true },
        ], 0, 1000, 1000);
        expect(history.incidents).toEqual([
            { status: 'offline', start: 100, end: 127, recoveredAt: 127, monitoringGap: false },
            { status: 'offline', start: 200, end: 227, recoveredAt: 227, monitoringGap: false },
        ]);
        expect(history).toMatchObject({ downtimeMs: 54, longestMs: 27, successPct: 60, checks: 5, coveragePct: 100 });
    });

    it('keeps monitoring gaps out of estimated downtime and does not invent recovery across them', () => {
        const history = summarizeHistory([{ at: 0, online: false }, { at: 1000, online: true }], 0, 1100, 100);
        expect(history.segments).toEqual([
            { status: 'offline', start: 0, end: 100 },
            { status: 'unknown', start: 100, end: 1000 },
            { status: 'online', start: 1000, end: 1100 },
        ]);
        expect(history.incidents[0]).toMatchObject({ recoveredAt: null, monitoringGap: true });
        expect(history.downtimeMs).toBe(100);
        expect(history.unknownMs).toBe(900);
        expect(history.successPct).toBe(50);
    });

    it('clips focused intervals while retaining the age of a preceding check', () => {
        const entries = [{ at: 0, online: false }, { at: 1000, online: true }];
        const history = summarizeHistory(entries, 50, 1050, 100);
        expect(history.segments).toEqual([
            { status: 'offline', start: 50, end: 100 },
            { status: 'unknown', start: 100, end: 1000 },
            { status: 'online', start: 1000, end: 1050 },
        ]);
        expect(summarizeHistory(entries, 500, 1050, 100).downtimeMs).toBe(0);
        expect(entries).toEqual([{ at: 0, online: false }, { at: 1000, online: true }]);
    });

    it('merges adjacent failed checks into one incident and leaves ongoing recovery unknown', () => {
        const history = summarizeHistory([{ at: 0, online: false }, { at: 30, online: false }], 0, 60, 100);
        expect(history.incidents).toHaveLength(1);
        expect(history.incidents[0]).toMatchObject({ start: 0, end: 60, recoveredAt: null, monitoringGap: false });
    });

    it('represents an unobserved interval as unknown instead of healthy', () => {
        expect(summarizeHistory([], 0, 100, 30)).toMatchObject({
            segments: [{ status: 'unknown', start: 0, end: 100 }],
            incidents: [], checks: 0, successPct: null, coveragePct: 0, downtimeMs: 0,
        });
        expect(summarizeHistory([{ at: 0, online: true }], 50, 100, 30).coveragePct).toBe(0);
    });
});

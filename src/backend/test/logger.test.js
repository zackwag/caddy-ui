import { afterEach, describe, expect, it, vi } from 'vitest';
import logger, {
    getRecentLogEntries,
    subscribeToLogs,
} from '../src/logger.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('application logger history', () => {
    it('stores structured log entries', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});

        logger.error('Route creation failed', {
            code: 'ROUTE_CREATE_FAILED',
            server: 'srv0',
        });

        expect(getRecentLogEntries().at(-1)).toMatchObject({
            level: 'error',
            message: 'Route creation failed',
            code: 'ROUTE_CREATE_FAILED',
            server: 'srv0',
        });

        expect(getRecentLogEntries().at(-1).ts).toEqual(expect.any(String));
    });

    it('notifies subscribers and stops after unsubscribe', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});

        const received = [];
        const unsubscribe = subscribeToLogs(entry => received.push(entry));

        logger.error('First message');

        unsubscribe();

        logger.error('Second message');

        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({
            level: 'error',
            message: 'First message',
        });
    });

    it('does not let a broken subscriber interrupt logging', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});

        const unsubscribe = subscribeToLogs(() => {
            throw new Error('disconnected client');
        });

        expect(() => logger.error('Still logged')).not.toThrow();

        expect(getRecentLogEntries().at(-1)).toMatchObject({
            level: 'error',
            message: 'Still logged',
        });

        unsubscribe();
    });

    it('caps retained history at 500 entries', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});

        for (let i = 0; i < 510; i++) {
            logger.error(`buffer-test-${i}`);
        }

        const entries = getRecentLogEntries();

        expect(entries).toHaveLength(500);
        expect(entries.at(-1).message).toBe('buffer-test-509');
        expect(
            entries.some(entry => entry.message === 'buffer-test-0')
        ).toBe(false);
    });
});
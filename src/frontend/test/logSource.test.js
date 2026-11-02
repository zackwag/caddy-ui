import { describe, expect, it } from 'vitest';
import { readLogResponse, resolveLogSource } from '../src/utils/logSource.js';

describe('log source links', () => {
    it.each([
        ['', 'caddy'],
        ['?dist=caddy', 'caddy'],
        ['?dist=app', 'app'],
        ['?other=value&dist=app', 'app'],
        ['?dist=', 'caddy'],
        ['?dist=unknown', 'caddy'],
        ['?dist=caddyui', 'caddy'],
    ])('selects the expected source for %s', (search, expected) => {
        expect(resolveLogSource(search)).toBe(expected);
    });

    it.each(['', '?dist=caddy', '?dist=app', '?dist=unknown'])(
        'keeps application logs available without instances for %s',
        search => {
            expect(resolveLogSource(search, true)).toBe('app');
        },
    );
});

describe('log read responses', () => {
    it('accepts a genuinely empty log file', () => {
        expect(readLogResponse({ lines: [], path: '/tmp/access.log' }, 'caddy')).toEqual([]);
    });
    it('keeps console and JSON lines as text', () => {
        const lines = ['INFO console message', '{"level":"info","msg":"JSON message"}'];
        expect(readLogResponse({ lines }, 'caddy')).toEqual(lines);
    });
    it('does not silently accept legacy HTTP 200 read failures', () => {
        expect(() => readLogResponse({ lines: [], error: 'private backend detail' }, 'caddy')).toThrowError(
            expect.objectContaining({ code: 'LOG_READ_FAILED', message: '' }),
        );
    });
    it('preserves semantic codes and request IDs from a legacy response', () => {
        expect(() => readLogResponse({ lines: [], error: 'private', code: 'LOG_FILE_MISSING', requestId: 'diagnostic' }, 'caddy')).toThrowError(
            expect.objectContaining({ code: 'LOG_FILE_MISSING', requestId: 'diagnostic' }),
        );
    });
    it.each([null, {}, { lines: null }, { lines: [{}] }])('rejects malformed responses instead of presenting an empty file', data => {
        expect(() => readLogResponse(data, 'caddy')).toThrowError(expect.objectContaining({ code: 'CLIENT_PARSE_FAILED' }));
    });
    it('continues rendering application log entries as JSON', () => {
        expect(readLogResponse({ entries: [{ level: 'info', message: 'example' }] }, 'app')).toEqual(['{"level":"info","message":"example"}']);
    });
});

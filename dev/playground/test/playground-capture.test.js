import { describe, expect, it } from 'vitest';
import { createReplayFetch, normalizeCapture, validateCapture } from '../capture-format.js';

const record = { request: { method: 'GET', path: '/status', body: null },
    response: { status: 200, headers: { 'content-type': 'application/json' }, body: { online: true, servers: [] } } };

describe('captured localization data', () => {
    it('rejects an unredacted shared CSRF replay context', () => {
        const capture = { formatVersion: 1, source: { commit: 'a'.repeat(40) }, scenarios: [{ id: 'online', requests: [record] }],
            csrfContext: { source: { commit: 'b'.repeat(40) }, record: {
                request: { method: 'GET', path: '/auth/csrf', body: null },
                response: { status: 200, headers: {}, body: { csrfToken: 'offline-preview-context' } },
            } },
        };
        expect(validateCapture(capture)).toBe(capture);
        capture.csrfContext.record.response.body.csrfToken = 'unredacted-value';
        expect(() => validateCapture(capture)).toThrow(/unredacted/);
    });
    it('preserves response shape and correlations while normalizing private addresses and timestamps', () => {
        const id = 'e1111111-1111-4111-8111-111111111111';
        const source = { header: id, body: { requestId: id, code: 'METRICS_UNAVAILABLE',
            adminUrl: 'http://127.0.0.1:54321', checkedAt: '2026-10-14T12:01:02.123Z', memory: 12.7, servers: [] } };
        const normalized = normalizeCapture(source, [['127.0.0.1:54321', 'caddy-preview:2019']]);
        expect(Object.keys(normalized.body)).toEqual(Object.keys(source.body));
        expect(normalized.header).toBe(normalized.body.requestId);
        expect(normalized.body.adminUrl).toBe('http://caddy-preview:2019');
        expect(normalized.body.checkedAt).toBe('2025-01-01T12:00:00.000Z');
        expect(normalized.body.memory).toBe(12.7);
        expect(source.body.requestId).toBe(id);
    });
    it('rejects unsupported formats and duplicate requests instead of selecting a response arbitrarily', () => {
        const capture = { formatVersion: 1, source: { commit: 'a'.repeat(40) }, scenarios: [{ id: 'online', requests: [record] }] };
        expect(validateCapture(capture)).toBe(capture);
        expect(() => validateCapture({ ...capture, formatVersion: 2 })).toThrow();
        expect(() => validateCapture({ ...capture, scenarios: [{ id: 'online', requests: [record, record] }] })).toThrow(/duplicate/);
    });
    it('retains time differences and case-insensitive request-ID correlations', () => {
        const id = 'e1111111-1111-4111-8111-111111111111';
        const normalized = normalizeCapture([id, id.toUpperCase(), '2026-10-14T12:00:00.000Z', '2026-10-14T12:00:01.500Z']);
        expect(normalized[0]).toBe(normalized[1]);
        expect(Date.parse(normalized[3]) - Date.parse(normalized[2])).toBe(1500);
    });
    it('preserves JSON scalar, text and no-content response semantics', async () => {
        const scalar = createReplayFetch([{ ...record, response: { ...record.response, body: 'a JSON string' } }]);
        expect(await (await scalar('/api/status')).json()).toBe('a JSON string');
        const text = createReplayFetch([{ ...record, response: { ...record.response, headers: { 'content-type': 'text/plain' }, body: 'raw text' } }]);
        expect(await (await text('/api/status')).text()).toBe('raw text');
        const empty = createReplayFetch([{ ...record, response: { ...record.response, status: 204, body: '' } }]);
        expect(await (await empty('/api/status')).text()).toBe('');
        expect(await (await scalar(new Request('http://preview.local/api/status'))).json()).toBe('a JSON string');
    });
    it('validates optional captured clocks without changing strict query matching', async () => {
        const capture = { formatVersion: 1, source: { commit: 'a'.repeat(40) },
            scenarios: [{ id: 'history', clock: 1700000000000, requests: [record] }] };
        expect(validateCapture(capture)).toBe(capture);
        for (const clock of [-1, '1700000000000', Infinity, 1.5]) {
            expect(() => validateCapture({ ...capture, scenarios: [{ ...capture.scenarios[0], clock }] })).toThrow(/clock/);
        }
        const replay = createReplayFetch([{ ...record, request: { method: 'GET', path: '/health/history?since=1700000000000', body: null } }]);
        expect((await replay('/api/health/history?since=1700000000000')).status).toBe(200);
        await expect(replay('/api/health/history?since=1700000000001')).rejects.toThrow(/Unrecorded/);
    });
    it('returns fresh real-shaped responses and preserves soft HTTP-200 failure contracts', async () => {
        const replay = createReplayFetch([{ ...record, response: { ...record.response, body: { ok: false, code: 'METRICS_UNAVAILABLE' } } }]);
        expect(await (await replay('/api/status')).json()).toEqual({ ok: false, code: 'METRICS_UNAVAILABLE' });
        expect((await replay('/api/status')).status).toBe(200);
    });
    it('refuses unrecorded writes, query variants and external URLs with no network fallback', async () => {
        const misses = [];
        const replay = createReplayFetch([record], message => misses.push(message));
        await expect(replay('/api/status', { method: 'DELETE' })).rejects.toThrow(/Unrecorded/);
        await expect(replay('/api/status?extra=true')).rejects.toThrow(/Unrecorded/);
        await expect(replay('https://example.com/api/status')).rejects.toThrow(/Unrecorded/);
        expect(misses).toHaveLength(3);
    });
    it('matches captured write bodies exactly and honors request cancellation', async () => {
        const replay = createReplayFetch([{ ...record, request: { method: 'PUT', path: '/server-names/srv0', body: { name: 'Playground HTTP' } } }]);
        const options = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Other name' }) };
        await expect(replay('/api/server-names/srv0', options)).rejects.toThrow(/Unrecorded/);
        options.body = JSON.stringify({ name: 'Playground HTTP' });
        expect((await replay('/api/server-names/srv0', options)).status).toBe(200);
        const controller = new AbortController();
        const error = new Error('Cancelled');
        controller.abort(error);
        await expect(replay('/api/server-names/srv0', { ...options, signal: controller.signal })).rejects.toBe(error);
    });
});

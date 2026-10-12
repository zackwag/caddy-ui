import { describe, expect, it, vi } from 'vitest';
import { errorCode, diagnosticMiddleware } from '../src/errorReporting.js';

describe('API error reporting', () => {
    it('uses stable error codes independent of internal error messages', () => {
        expect(errorCode('/api/caddyfile/validations', 422)).toBe('CADDYFILE_VALIDATION_FAILED');
        expect(errorCode('/api/status', 200)).toBe('CADDY_STATUS_UNAVAILABLE');
        expect(errorCode('/api/metrics', 200)).toBe('METRICS_UNAVAILABLE');
    });
    it('adds an ID and code without replacing technical detail on 500 responses', () => {
        const req = { method: 'GET', path: '/api/settings' };
        const res = { statusCode: 500, setHeader: vi.fn(), json: vi.fn(x => x) };
        diagnosticMiddleware(req, res, () => {});
        const output = res.json({ error: 'backend details' });
        expect(output.error).toBe('backend details');
        expect(output.code).toBe('REQUEST_FAILED');
        expect(output.requestId).toEqual(expect.any(String));
        expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', output.requestId);
    });
    it('keeps successful responses unchanged', () => {
        const req = { method: 'GET', path: '/api/settings' };
        const res = { statusCode: 200, setHeader: vi.fn(), json: vi.fn(x => x) };
        diagnosticMiddleware(req, res, () => {});
        expect(res.json({ enabled: true })).toEqual({ enabled: true });
    });
});

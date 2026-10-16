import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorCode, diagnosticMiddleware } from '../src/errorReporting.js';
import logger from '../src/logger.js';

describe('API error reporting', () => {
    afterEach(() => vi.restoreAllMocks());
    it('uses stable error codes independent of internal error messages', () => {
        expect(errorCode('/api/caddyfile/validations', 422)).toBe('CADDYFILE_VALIDATION_FAILED');
        expect(errorCode('/api/status', 200)).toBe('CADDY_STATUS_UNAVAILABLE');
        expect(errorCode('/api/metrics', 200)).toBe('METRICS_UNAVAILABLE');
    });
    it.each([
        [401, 'UNAUTHORIZED'],
        [403, 'FORBIDDEN'],
    ])('reports HTTP %s with its distinct authentication or permission code', (statusCode, code) => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const req = { method: 'PUT', path: '/api/settings' };
        const res = { statusCode, setHeader: vi.fn(), json: vi.fn(x => x) };
        diagnosticMiddleware(req, res, () => {});
        const output = res.json({ error: 'Access denied' });
        expect(output.code).toBe(code);
        expect(output.requestId).toBe(req.diagnosticId);
        expect(warn).toHaveBeenCalledWith('API request failed', expect.objectContaining({ code, status: statusCode }));
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
    it('retains the full path after a mounted router changes req.path', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const req = { method: 'POST', path: '/api/caddyfile/validations', originalUrl: '/api/caddyfile/validations?private=value' };
        const res = { statusCode: 422, setHeader: vi.fn(), json: vi.fn(x => x) };
        diagnosticMiddleware(req, res, () => {});
        req.path = '/validations';
        const output = res.json({ errors: ['invalid directive'] });
        expect(output.code).toBe('CADDYFILE_VALIDATION_FAILED');
        expect(req.diagnosticPath).toBe('/api/caddyfile/validations');
        expect(warn).toHaveBeenCalledWith('API request failed', expect.objectContaining({
            path: '/api/caddyfile/validations', code: output.code, requestId: output.requestId,
        }));
    });
    it.each(['/api/status', '/api/status/'])('recognizes soft status failures inside a mounted router at %s', path => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
        const req = { method: 'GET', path, originalUrl: path };
        const res = { statusCode: 200, setHeader: vi.fn(), json: vi.fn(x => x) };
        diagnosticMiddleware(req, res, () => {});
        req.path = '/';
        const output = res.json({ online: false, error: 'Caddy status unavailable' });
        expect(output.code).toBe('CADDY_STATUS_UNAVAILABLE');
        expect(output.requestId).toBe(req.diagnosticId);
        expect(warn).toHaveBeenCalledOnce();
        expect(error).not.toHaveBeenCalled();
    });
    it.each([200, 503])('uses registered severity for METRICS_UNAVAILABLE with HTTP %s', statusCode => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
        const req = { method: 'GET', path: '/api/status/process' };
        const res = { statusCode, setHeader: vi.fn(), json: vi.fn(x => x) };
        diagnosticMiddleware(req, res, () => {});
        res.json({ ok: false, error: 'Metrics unavailable', code: 'METRICS_UNAVAILABLE' });
        expect(warn).toHaveBeenCalledOnce();
        expect(error).not.toHaveBeenCalled();
    });
    it('keeps HTTP-based severity for an unknown legacy code', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
        const req = { method: 'GET', path: '/api/settings' };
        const res = { statusCode: 404, setHeader: vi.fn(), json: vi.fn(x => x) };
        diagnosticMiddleware(req, res, () => {});
        res.json({ error: 'missing', code: 'LEGACY_UNKNOWN' });
        expect(warn).toHaveBeenCalledOnce();
        expect(error).not.toHaveBeenCalled();
    });
    it('correlates successful warning responses with the original path', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const req = { method: 'PUT', path: '/api/caddyfile', originalUrl: '/api/caddyfile?validate=false' };
        const res = { statusCode: 200, setHeader: vi.fn(), json: vi.fn(x => x) };
        diagnosticMiddleware(req, res, () => {});
        req.path = '/';
        const output = res.json({ ok: true, warning: 'Reload failed' });
        expect(output.requestId).toBe(req.diagnosticId);
        expect(output.code).toBeUndefined();
        expect(warn).toHaveBeenCalledWith('API returned a warning', expect.objectContaining({ path: '/api/caddyfile' }));
    });
});

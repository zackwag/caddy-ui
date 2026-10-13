import { describe, expect, it } from 'vitest';
import { AppError, asAppError, errorChain, publicError } from '../src/AppError.js';
import { ERROR_REGISTRY } from '../src/errorRegistry.js';
import { diagnosticMiddleware, sendAppError } from '../src/errorReporting.js';

describe('semantic application errors', () => {
    it('requires a registered code and preserves the cause chain', () => {
        const cause = Object.assign(new Error('permission denied'), { code: 'EACCES' });
        const appError = new AppError('CADDYFILE_READ_FAILED', { cause, context: { instanceId: 'test' } });
        expect(errorChain(appError).map(e => e.code)).toEqual(['CADDYFILE_READ_FAILED', 'EACCES']);
        expect(appError.cause).toBe(cause);
        expect(() => new AppError('MADE_UP_CODE')).toThrow(TypeError);
        expect(asAppError(appError, 'REQUEST_FAILED')).toBe(appError);
    });
    it('returns only public fields and a stable status', () => {
        const error = new AppError('CERTIFICATE_DELETE_DENIED', { cause: new Error('secret path') });
        expect(publicError(error)).toEqual({ code: 'CERTIFICATE_DELETE_DENIED', error: 'Operation failed' });
        expect(ERROR_REGISTRY.CERTIFICATE_DELETE_DENIED.status).toBe(403);
        const req = { method: 'DELETE', path: '/api/tls/example.com' };
        const res = { statusCode: 200, locals: {}, setHeader() {}, status(s) { this.statusCode = s; return this; }, json(body) { return body; } };
        diagnosticMiddleware(req, res, () => {});
        const body = sendAppError(res, error);
        expect(res.statusCode).toBe(403);
        expect(body.code).toBe('CERTIFICATE_DELETE_DENIED');
        expect(body.requestId).toBe(req.diagnosticId);
        expect(JSON.stringify(body)).not.toContain('secret path');
    });
});

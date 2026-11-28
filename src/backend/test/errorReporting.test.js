import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/AppError.js';
import { errorHandler, sendFailure } from '../src/errorReporting.js';
import logger from '../src/logger.js';
import { serve } from './fixtures/server.mjs';

let server;
let respond;

beforeAll(async () => {
    server = await serve(app => {
        app.use('/api/mounted', (req, res, next) => respond(req, res, next));
    });
});
afterAll(() => server.close());
beforeEach(() => {
    for (const level of ['warn', 'error']) {
        vi.spyOn(logger, level).mockImplementation(() => {});
    }
});
afterEach(() => vi.restoreAllMocks());

async function request(handler) {
    respond = handler;
    const response = await fetch(server.url + '/api/mounted/item?private=value');
    const body = await response.json();
    return { status: response.status, body, requestId: response.headers.get('X-Request-ID') };
}

describe('API error reporting', () => {
    it.each([
        [400, 'VALIDATION_FAILED'], [401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [409, 'CONFLICT'],
        [422, 'VALIDATION_FAILED'], [429, 'RATE_LIMITED'], [500, 'REQUEST_FAILED'], [502, 'UPSTREAM_UNAVAILABLE'],
    ])('gives HTTP %s without a code a stable one', async (status, code) => {
        const { body, requestId } = await request((req, res) => res.status(status).json({ error: 'details' }));
        expect(body).toEqual({ error: 'details', code, requestId });
        expect(requestId).toEqual(expect.any(String));
        expect(logger[status >= 500 ? 'error' : 'warn']).toHaveBeenCalledOnce();
    });

    it('logs the full path of a mounted router without its query', async () => {
        const { requestId } = await request((req, res) => res.status(404).json({ error: 'missing' }));
        expect(logger.warn).toHaveBeenCalledWith('API request failed', expect.objectContaining({ path: '/api/mounted/item', requestId }));
    });

    it('keeps successful responses unchanged', async () => {
        expect((await request((req, res) => res.json({ enabled: true }))).body).toEqual({ enabled: true });
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('responds to a thrown AppError with its status and public fields only', async () => {
        const { status, body, requestId } = await request(() => {
            throw new AppError('CERTIFICATE_DELETE_DENIED', { cause: new Error('secret path') });
        });
        expect(status).toBe(403);
        expect(body).toEqual({ code: 'CERTIFICATE_DELETE_DENIED', error: 'Operation failed', requestId });
        expect(logger.warn).toHaveBeenCalledWith('API request failed', expect.objectContaining({
            causes: [expect.objectContaining({ code: 'CERTIFICATE_DELETE_DENIED' }), expect.objectContaining({ message: 'secret path' })],
        }));
    });

    it('responds to anything else thrown as an unhandled error without its message', async () => {
        const { status, body, requestId } = await request(async () => { throw new Error('ENOENT: /etc/caddy/secret'); });
        expect(status).toBe(500);
        expect(body).toEqual({ error: 'Internal server error', code: 'REQUEST_FAILED', requestId });
    });

    it('leaves an error after the response started to Express', () => {
        const next = vi.fn();
        const error = new Error('stream failed');
        errorHandler(error, {}, { headersSent: true }, next);
        expect(next).toHaveBeenCalledWith(error);
    });

    it('reports a failure in a 200 response with the registered severity', async () => {
        const { status, body, requestId } = await request((req, res) =>
            sendFailure(res, new AppError('METRICS_UNAVAILABLE'), { ok: false, error: 'Metrics unavailable' }, 200));
        expect(status).toBe(200);
        expect(body).toEqual({ code: 'METRICS_UNAVAILABLE', ok: false, error: 'Metrics unavailable', requestId });
        expect(logger.warn).toHaveBeenCalledOnce();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('sends a failure with fields of its own and the status of its error', async () => {
        const { status, body } = await request((req, res) =>
            sendFailure(res, new AppError('CADDYFILE_VALIDATION_FAILED'), { valid: false, errors: ['bad directive'] }));
        expect(status).toBe(422);
        expect(body).toMatchObject({ code: 'CADDYFILE_VALIDATION_FAILED', valid: false, errors: ['bad directive'] });
    });

    it('correlates warnings on successful responses without calling them failures', async () => {
        const { body, requestId } = await request((req, res) => res.json({ ok: true, warning: 'Reload failed' }));
        expect(body.requestId).toBe(requestId);
        expect(body.code).toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith('API returned a warning', expect.objectContaining({ path: '/api/mounted/item' }));
    });
});

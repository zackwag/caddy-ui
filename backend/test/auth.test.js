import { describe, expect, it, vi } from 'vitest';

describe('authMiddleware', () => {
    async function loadAuth(env = {}) {
        vi.resetModules();
        for (const [k, v] of Object.entries(env)) process.env[k] = v;
        const mod = await import('../src/middleware/auth.js');
        for (const k of Object.keys(env)) delete process.env[k];
        return mod;
    }

    function mockReqRes(overrides = {}) {
        const req = {
            headers: {},
            query: {},
            path: '/api/routes',
            ...overrides,
        };
        const res = {
            _status: null,
            _json: null,
            status(code) { res._status = code; return res; },
            json(data) { res._json = data; return res; },
        };
        return { req, res };
    }

    it('calls next() when auth is not configured', async () => {
        const { authMiddleware } = await loadAuth({});
        const { req, res } = mockReqRes();
        const next = vi.fn();
        authMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    it('returns 401 when no token is provided and auth is enabled', async () => {
        const { authMiddleware } = await loadAuth({
            CADDY_UI_USER: 'admin',
            CADDY_UI_PASSWORD: 'pass',
            JWT_SECRET: 'test-secret',
        });
        const { req, res } = mockReqRes();
        const next = vi.fn();
        authMiddleware(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res._status).toBe(401);
        expect(res._json.error).toBe('Unauthorized');
    });

    it('calls next() with a valid Bearer token', async () => {
        const jwt = (await import('jsonwebtoken')).default;
        const secret = 'test-secret-valid';
        const token = jwt.sign({ username: 'admin' }, secret);
        const { authMiddleware } = await loadAuth({
            CADDY_UI_USER: 'admin',
            CADDY_UI_PASSWORD: 'pass',
            JWT_SECRET: secret,
        });
        const { req, res } = mockReqRes({
            headers: { authorization: `Bearer ${token}` },
        });
        const next = vi.fn();
        authMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    it('calls next() with a valid query token', async () => {
        const jwt = (await import('jsonwebtoken')).default;
        const secret = 'test-secret-query';
        const token = jwt.sign({ username: 'admin' }, secret);
        const { authMiddleware } = await loadAuth({
            CADDY_UI_USER: 'admin',
            CADDY_UI_PASSWORD: 'pass',
            JWT_SECRET: secret,
        });
        const { req, res } = mockReqRes({ query: { token } });
        const next = vi.fn();
        authMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    it('returns 401 for an invalid token', async () => {
        const { authMiddleware } = await loadAuth({
            CADDY_UI_USER: 'admin',
            CADDY_UI_PASSWORD: 'pass',
            JWT_SECRET: 'real-secret',
        });
        const { req, res } = mockReqRes({
            headers: { authorization: 'Bearer invalid.token.here' },
        });
        const next = vi.fn();
        authMiddleware(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res._status).toBe(401);
        expect(res._json.error).toBe('Invalid or expired token');
    });

    it('allows /metrics path through when publicMetrics is enabled', async () => {
        const { authMiddleware } = await loadAuth({
            CADDY_UI_USER: 'admin',
            CADDY_UI_PASSWORD: 'pass',
            JWT_SECRET: 'test-secret',
            CADDY_UI_PUBLIC_METRICS: 'true',
        });
        const { req, res } = mockReqRes({ path: '/metrics' });
        const next = vi.fn();
        authMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });
});

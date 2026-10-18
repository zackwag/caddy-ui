import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, authRequest, fetchAuthStatus, resetAuthContext } from '../src/utils/api.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const storage = new Map();
beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        removeItem: key => storage.delete(key),
    });
    resetAuthContext();
});
afterEach(() => { resetAuthContext(); vi.unstubAllGlobals(); });

describe('cookie authentication client', () => {
    it.each([[401, 'UNAUTHORIZED', true], [403, 'FORBIDDEN', false]])('distinguishes HTTP %s from permission failures', async (status, code, signedOut) => {
        const onUnauth = vi.fn();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code, error: 'Operation failed', requestId: 'request-diagnostic' }, status)));
        await expect(apiFetch('/settings', {}, onUnauth)).rejects.toMatchObject({ code, status, requestId: 'request-diagnostic' });
        expect(onUnauth).toHaveBeenCalledTimes(signedOut ? 1 : 0);
        expect(fetch.mock.calls[0][1].credentials).toBe('same-origin');
        expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    });

    it('attaches a CSRF token to writes and does not replay a rejected mutation', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(json({ csrfToken: 'first-context' }))
            .mockResolvedValueOnce(json({ code: 'CSRF_INVALID' }, 403))
            .mockResolvedValueOnce(json({ csrfToken: 'replacement-context' }))
            .mockResolvedValueOnce(json({ ok: true })));
        await expect(apiFetch('/settings', { method: 'PUT' })).rejects.toMatchObject({ code: 'CSRF_INVALID' });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls[1][1].headers['X-CSRF-Token']).toBe('first-context');
        await apiFetch('/settings', { method: 'PUT' });
        expect(fetch.mock.calls[3][1].headers['X-CSRF-Token']).toBe('replacement-context');
    });

    it('refreshes the CSRF context after login changes the cookie', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(json({ csrfToken: 'pre-login' }))
            .mockResolvedValueOnce(json({ ok: true }))
            .mockResolvedValueOnce(json({ csrfToken: 'signed-in' }))
            .mockResolvedValueOnce(json({ ok: true })));
        await authRequest('/sessions', { method: 'POST' });
        await apiFetch('/settings', { method: 'PUT' });
        expect(fetch.mock.calls[1][1].headers['X-CSRF-Token']).toBe('pre-login');
        expect(fetch.mock.calls[3][1].headers['X-CSRF-Token']).toBe('signed-in');
    });

    it('rejects malformed authentication status instead of trusting cached local state', async () => {
        storage.set('caddy_ui_token', 'obsolete-session');
        storage.set('caddy_ui_auth_enabled', 'false');
        resetAuthContext();
        expect(storage.size).toBe(0);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ authEnabled: false })));
        await expect(fetchAuthStatus()).rejects.toMatchObject({ code: 'INVALID_LOCAL_STATE' });
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, authRequest, fetchAuthStatus, getInstanceId, onInstanceSelectionReset, resetAuthContext, setInstanceId } from '../src/utils/api.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const storage = new Map();
beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
    });
    resetAuthContext();
});
afterEach(() => { resetAuthContext(); vi.unstubAllGlobals(); });

describe('cookie authentication client', () => {
    it('reports network loss while establishing CSRF context without sending a mutation', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
        await expect(apiFetch('/settings', { method: 'PUT' })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0]).toBe('/api/auth/csrf');
    });
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

describe('stale instance selection', () => {
    it('pins a write to its original instance while CSRF preparation is pending', async () => {
        setInstanceId('alpha');
        let releaseContext;
        const context = new Promise(resolve => { releaseContext = resolve; });
        const fetchMock = vi.fn().mockReturnValueOnce(context).mockResolvedValueOnce(json({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);
        const pending = apiFetch('/caddyfile', { method: 'PUT', body: 'intended for alpha' });
        setInstanceId('beta');
        releaseContext(json({ csrfToken: 'request-context' }));
        await pending;
        expect(fetchMock.mock.calls[1][1].headers['X-Instance-Id']).toBe('alpha');
        expect(getInstanceId()).toBe('beta');
    });

    const rejectSelection = () => new Response(JSON.stringify({
        code: 'INSTANCE_SELECTION_INVALID', error: 'Selected instance not found',
    }), { status: 404, headers: { 'Content-Type': 'application/json' } });

    it('drops the selection and notifies without retrying the request', async () => {
        setInstanceId('deleted-instance');
        const fetchMock = vi.fn().mockResolvedValueOnce(json({ csrfToken: 'request-context' })).mockResolvedValueOnce(rejectSelection());
        vi.stubGlobal('fetch', fetchMock);
        const onReset = vi.fn();
        const unsubscribe = onInstanceSelectionReset(onReset);

        await expect(apiFetch('/caddyfile', { method: 'PUT' })).rejects.toMatchObject({
            code: 'INSTANCE_SELECTION_INVALID', status: 404,
        });
        unsubscribe();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/csrf');
        expect(fetchMock.mock.calls[1][1].headers['X-Instance-Id']).toBe('deleted-instance');
        expect(fetchMock.mock.calls[1][1].headers['X-CSRF-Token']).toBe('request-context');
        expect(getInstanceId()).toBe('default');
        expect(onReset).toHaveBeenCalledTimes(1);
    });

    it('keeps a selection the user made while the request was in flight', async () => {
        setInstanceId('deleted-instance');
        vi.stubGlobal('fetch', vi.fn(async () => {
            setInstanceId('beta');
            return rejectSelection();
        }));
        const onReset = vi.fn();
        const unsubscribe = onInstanceSelectionReset(onReset);

        await expect(apiFetch('/routes')).rejects.toMatchObject({ code: 'INSTANCE_SELECTION_INVALID' });
        unsubscribe();
        expect(getInstanceId()).toBe('beta');
        expect(onReset).not.toHaveBeenCalled();
    });
});

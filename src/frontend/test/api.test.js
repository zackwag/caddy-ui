import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, getInstanceId, getToken, onInstanceSelectionReset, setInstanceId, setToken } from '../src/utils/api.js';

describe('authentication error feedback', () => {
    afterEach(() => vi.unstubAllGlobals());

    it.each([
        [401, 'UNAUTHORIZED', true],
        [403, 'FORBIDDEN', false],
    ])('handles HTTP %s without confusing authentication and permission failures', async (status, code, signedOut) => {
        const storage = new Map();
        vi.stubGlobal('localStorage', {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key),
        });
        setToken('existing-session');
        const onUnauth = vi.fn();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code, error: 'Operation failed', requestId: 'request-diagnostic',
        }), { status, headers: { 'Content-Type': 'application/json' } })));

        await expect(apiFetch('/settings', {}, onUnauth)).rejects.toMatchObject({
            code, status, requestId: 'request-diagnostic',
        });
        expect(getToken()).toBe(signedOut ? null : 'existing-session');
        expect(onUnauth).toHaveBeenCalledTimes(signedOut ? 1 : 0);
    });
});

describe('stale instance selection', () => {
    afterEach(() => vi.unstubAllGlobals());

    const stubStorage = () => {
        const storage = new Map();
        vi.stubGlobal('localStorage', {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key),
        });
    };
    const rejectSelection = () => new Response(JSON.stringify({
        code: 'INSTANCE_SELECTION_INVALID', error: 'Selected instance not found',
    }), { status: 404, headers: { 'Content-Type': 'application/json' } });

    it('drops the selection and notifies without retrying the request', async () => {
        stubStorage();
        setInstanceId('deleted-instance');
        const fetchMock = vi.fn().mockResolvedValue(rejectSelection());
        vi.stubGlobal('fetch', fetchMock);
        const onReset = vi.fn();
        const unsubscribe = onInstanceSelectionReset(onReset);

        await expect(apiFetch('/caddyfile', { method: 'PUT' })).rejects.toMatchObject({
            code: 'INSTANCE_SELECTION_INVALID', status: 404,
        });
        unsubscribe();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1].headers['X-Instance-Id']).toBe('deleted-instance');
        expect(getInstanceId()).toBe('default');
        expect(onReset).toHaveBeenCalledTimes(1);
    });

    it('keeps a selection the user made while the request was in flight', async () => {
        stubStorage();
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

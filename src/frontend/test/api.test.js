import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, getToken, setToken } from '../src/utils/api.js';

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

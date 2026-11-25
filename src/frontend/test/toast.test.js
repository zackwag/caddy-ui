import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotificationCenter } from '../src/utils/notificationCenter.js';
import { createToast } from '../src/utils/toast.js';

let center, toast, instance;
const shown = () => center.getSnapshot().map(({ msg, type }) => [type, msg]);
const failing = (code = 'NETWORK_ERROR') => Promise.reject(Object.assign(new Error('private detail'), { code }));

beforeEach(() => {
    instance = 'alpha';
    vi.stubGlobal('localStorage', { getItem: () => instance });
    center = createNotificationCenter();
    toast = createToast(center, key => key);
});

describe('toasts', () => {
    it('show localized errors, never their own text', () => {
        toast.error(Object.assign(new Error('private detail'), { code: 'CONFLICT', requestId: 'diagnostic' }));
        expect(shown()).toEqual([['error', 'errors.conflict']]);
        expect(center.getSnapshot()[0]).toMatchObject({ code: 'CONFLICT', requestId: 'diagnostic' });
    });

    it.each([
        ['CONFIG_VERIFICATION_MISMATCH', 'errors.configVerificationMismatch'],
        ['UNKNOWN_WARNING', 'errors.operationWarning'],
        [undefined, 'errors.operationWarning'],
    ])('report a saved change with the warning %s instead of plain success', (warningCode, message) => {
        toast.saved({ ok: true, warning: 'server detail', warningCode }, 'saved');
        expect(shown()).toEqual([['info', message]]);
    });

    it('report a clean save as success', () => {
        toast.saved({ ok: true, verification: { file: 'verified', live: 'verified' } }, 'saved');
        expect(shown()).toEqual([['success', 'saved']]);
    });
});

describe('tracked requests', () => {
    it('settle like the request', async () => {
        await expect(toast.track('routes.load', Promise.resolve('value'))).resolves.toBe('value');
        await expect(toast.track('routes.load', failing())).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });

    it('report an outage once, until a request succeeds again', async () => {
        for (let i = 0; i < 3; i++) await toast.track('routes.load', failing()).catch(() => {});
        expect(shown()).toEqual([['error', 'errors.network']]);
        await toast.track('routes.load', Promise.resolve());
        expect(shown()).toEqual([]);
        await toast.track('routes.load', failing()).catch(() => {});
        expect(shown()).toHaveLength(1);
    });

    it('keep the outages of different views and instances apart', async () => {
        await toast.track('routes.load', failing()).catch(() => {});
        await toast.track('tls.load', failing()).catch(() => {});
        instance = 'beta';
        await toast.track('routes.load', failing()).catch(() => {});
        expect(shown()).toHaveLength(3);
        await toast.track('routes.load', Promise.resolve());
        expect(shown()).toHaveLength(2);
    });

    it('belong to the instance they were sent for', async () => {
        const request = Promise.withResolvers();
        const tracked = toast.track('routes.load', request.promise).catch(() => {});
        instance = 'beta';
        request.reject(Object.assign(new Error(), { code: 'NETWORK_ERROR' }));
        await tracked;
        instance = 'alpha';
        await toast.track('routes.load', Promise.resolve());
        expect(shown()).toEqual([]);
    });

    it('leave having no instances to the page shown for it', async () => {
        await toast.track('logs.load', failing('NO_INSTANCES')).catch(() => {});
        expect(shown()).toEqual([]);
    });
});

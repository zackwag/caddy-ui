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

    it('neither report nor deliver an outcome once their view aborts them', async () => {
        await toast.track('routes.load', failing()).catch(() => {});
        const settled = vi.fn();
        for (const request of [failing(), Promise.resolve('value')]) {
            const controller = new AbortController();
            const pending = Promise.withResolvers();
            toast.track('logs.config', pending.promise, { signal: controller.signal }).then(settled, settled);
            controller.abort();
            request.then(pending.resolve, pending.reject);
            await request.catch(() => {});
            await new Promise(resolve => setTimeout(resolve));
        }
        expect(settled).not.toHaveBeenCalled();
        // An aborted success doesn't end another request's outage either
        toast.track('routes.load', Promise.resolve('value'), { signal: AbortSignal.abort() }).then(settled);
        await new Promise(resolve => setTimeout(resolve));
        expect(settled).not.toHaveBeenCalled();
        expect(shown()).toEqual([['error', 'errors.network']]);
    });

    it('leave having no instances to the page shown for it', async () => {
        await toast.track('logs.load', failing('NO_INSTANCES')).catch(() => {});
        expect(shown()).toEqual([]);
    });
});

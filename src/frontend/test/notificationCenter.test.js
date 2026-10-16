import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotificationCenter, stateNotificationKey, MAX_VISIBLE_TOASTS } from '../src/utils/notificationCenter.js';

describe('central notification policies', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('deduplicates continuing state failures even after the toast expires', () => {
        const center = createNotificationCenter();
        const key = stateNotificationKey('routes.load', 'prod');
        expect(center.notify('unavailable', 'error', { code: 'NETWORK_ERROR', requestId: 'first' }, { mode: 'state', key })).toBe(true);
        expect(center.notify('unavailable', 'error', { code: 'NETWORK_ERROR', requestId: 'second' }, { mode: 'state', key })).toBe(false);
        expect(center.getSnapshot()).toHaveLength(1);
        expect(center.getSnapshot()[0].requestId).toBe('first');
        vi.advanceTimersByTime(6000);
        expect(center.getSnapshot()).toHaveLength(0);
        expect(center.notify('still unavailable', 'error', null, { mode: 'state', key })).toBe(false);
    });

    it('rearms on recovery without creating a success toast automatically', () => {
        const center = createNotificationCenter();
        const key = stateNotificationKey('tls.load', 'default');
        center.notify('offline', 'error', null, { mode: 'state', key });
        expect(center.recover(key)).toBe(true);
        expect(center.getSnapshot()).toHaveLength(0);
        expect(center.recover(key)).toBe(false);
        expect(center.notify('offline again', 'error', null, { mode: 'state', key })).toBe(true);
        expect(center.getSnapshot()).toHaveLength(1);
    });

    it('keeps repeated user-initiated events separate with their own diagnostics', () => {
        const center = createNotificationCenter();
        center.notify('Save failed', 'error', { code: 'CADDY_RELOAD_FAILED', requestId: 'a' });
        center.notify('Save failed', 'error', { code: 'CADDY_RELOAD_FAILED', requestId: 'b' });
        expect(center.getSnapshot().map(t => t.requestId)).toEqual(['a', 'b']);
    });

    it('tracks distinct incidents independently and forgets states on instance switch', () => {
        const center = createNotificationCenter();
        center.notify('a', 'error', null, { mode: 'state', key: 'load:a' });
        center.notify('b', 'error', null, { mode: 'state', key: 'load:b' });
        center.notify('manual action', 'success');
        expect(center.getSnapshot()).toHaveLength(3);
        center.clearStates();
        expect(center.getSnapshot().map(t => t.msg)).toEqual(['manual action']);
        expect(center.notify('a again', 'error', null, { mode: 'state', key: 'load:a' })).toBe(true);
    });

    it('bounds visible toasts and cancels discarded timers', () => {
        const cancel = vi.fn(clearTimeout);
        const center = createNotificationCenter({ cancel });
        for (let i = 0; i < MAX_VISIBLE_TOASTS + 3; i++) center.notify(String(i));
        expect(center.getSnapshot()).toHaveLength(MAX_VISIBLE_TOASTS);
        expect(cancel).toHaveBeenCalledTimes(3);
        vi.runAllTimers();
        expect(center.getSnapshot()).toHaveLength(0);
    });

    it('does not accept unstable state keys or unknown modes', () => {
        const center = createNotificationCenter();
        expect(() => center.notify('broken', 'error', null, { mode: 'state' })).toThrow(TypeError);
        expect(() => center.notify('broken', 'error', null, { mode: 'once' })).toThrow(TypeError);
    });
});

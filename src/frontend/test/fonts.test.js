import { describe, expect, it, vi } from 'vitest';
import { createFontLoader } from '../src/i18n/fonts.js';

describe('optional font loading', () => {
    it('keeps disabled fonts and unsupported configuration from making requests', async () => {
        const load = vi.fn();
        const fonts = createFontLoader({ ar: load });
        await fonts.load('ar');
        fonts.configure(['unknown', '__proto__']);
        await fonts.load('unknown');
        await fonts.load('ar');
        expect(load).not.toHaveBeenCalled();
    });

    it('loads only the selected opted-in language, sharing concurrent and repeated loads', async () => {
        const load = vi.fn().mockResolvedValue({});
        const fonts = createFontLoader({ ar: load });
        fonts.configure(['ar']);
        await fonts.load('en');
        expect(load).not.toHaveBeenCalled();
        await Promise.all([fonts.load('ar'), fonts.load('ar')]);
        await fonts.load('ar');
        expect(load).toHaveBeenCalledTimes(1);
        fonts.configure([]);
        await fonts.load('ar');
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('retains system fallback on failure, reports once and permits a later retry', async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error('CSS download failed')).mockResolvedValue({});
        const warn = vi.fn();
        const fonts = createFontLoader({ ar: load }, warn);
        fonts.configure(['ar']);
        await Promise.all([fonts.load('ar'), fonts.load('ar')]);
        expect(warn).toHaveBeenCalledTimes(1);
        await fonts.load('ar');
        expect(load).toHaveBeenCalledTimes(2);
    });
});

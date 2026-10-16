import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, { availableLocales, fetchEnabledLanguages, loadLocale } from '../src/i18n/index.js';
import { additionalFonts } from '../src/i18n/fonts.js';

describe('i18n integration', () => {
    afterEach(async () => {
        vi.unstubAllGlobals();
        await loadLocale('en');
        additionalFonts.configure([]);
        vi.restoreAllMocks();
    });

    it('lazy-loads a locale and falls back to English for missing keys', async () => {
        expect(i18n.t('test.languageLoaded')).toBe('English loaded');

        await loadLocale('de');

        expect(i18n.language).toBe('de');
        expect(i18n.t('test.languageLoaded')).toBe('Deutsch geladen');
        expect(i18n.t('common.save')).toBe('Save');
    });

    it('loads the probe key for every installed locale advertised by the language API', async () => {
        vi.stubGlobal('localStorage', { getItem: () => null });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
            JSON.stringify({ languages: [...availableLocales, 'zz'] }),
            { headers: { 'Content-Type': 'application/json' } },
        )));

        const enabled = await fetchEnabledLanguages();

        expect(enabled).toEqual(availableLocales);
        expect(fetch).toHaveBeenCalledWith('/api/languages', expect.anything());

        for (const locale of enabled) {
            await loadLocale(locale);
            const probe = i18n.t('test.languageLoaded');

            expect(probe).toBeTruthy();
            expect(probe).not.toBe('test.languageLoaded');
        }
    });

    it('switches document direction with Arabic and restores it on fallback', async () => {
        const documentElement = {};
        vi.stubGlobal('document', { documentElement });

        await loadLocale('ar');

        expect(documentElement).toMatchObject({ lang: 'ar', dir: 'rtl' });
        for (const count of [0, 1, 2, 3, 11, 100]) {
            expect(i18n.t('logs.lineCount', { count })).toBe(`عدد الأسطر: ${count}`);
        }

        await loadLocale('unknown-locale');
        expect(documentElement).toMatchObject({ lang: 'en', dir: 'ltr' });
    });

    it('configures bundled fonts from the language API and loads them on locale change', async () => {
        vi.stubGlobal('localStorage', { getItem: () => null });
        const configure = vi.spyOn(additionalFonts, 'configure');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
            JSON.stringify({ languages: ['en', 'ar'], fonts: ['ar'] }),
            { headers: { 'Content-Type': 'application/json' } },
        )));
        expect(await fetchEnabledLanguages()).toEqual(['en', 'ar']);
        expect(configure).toHaveBeenCalledWith(['ar']);
        const load = vi.spyOn(additionalFonts, 'load').mockResolvedValue();
        await loadLocale('AR');
        expect(load).toHaveBeenCalledWith('ar');
        expect(i18n.language).toBe('ar');
    });
});

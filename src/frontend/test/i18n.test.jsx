import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, { availableLocales, fetchEnabledLanguages, loadLocale } from '../src/i18n/index.js';
import { additionalFonts } from '../src/i18n/fonts.js';
import spanish from '../src/i18n/locales/es-es.js';

describe('i18n integration', () => {
    afterEach(async () => {
        vi.unstubAllGlobals();
        await loadLocale('en');
        additionalFonts.configure([]);
        vi.restoreAllMocks();
    });

    it('lazy-loads the German catalog', async () => {
        const english = i18n.t('test.languageLoaded');

        await loadLocale('de');

        expect(i18n.language).toBe('de');
        expect(i18n.t('test.languageLoaded')).not.toBe(english);
    });

    it('falls back to English for keys missing from a locale', async () => {
        await loadLocale('de');
        i18n.addResourceBundle('en', 'fallback-test', { message: 'English fallback' });
        i18n.addResourceBundle('de', 'fallback-test', {});

        try {
            expect(i18n.t('message', { ns: 'fallback-test' })).toBe('English fallback');
        } finally {
            i18n.removeResourceBundle('en', 'fallback-test');
            i18n.removeResourceBundle('de', 'fallback-test');
        }
    });

    it('resolves a regional catalog', async () => {
        await loadLocale('es-ES');

        expect(i18n.resolvedLanguage).toBe('es-es');
        expect(i18n.t('test.languageLoaded')).toBe(spanish.test.languageLoaded);
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
            expect(i18n.t('logs.lineCount', { count })).toContain(String(count));
        }

        await loadLocale('unknown-locale');
        expect(documentElement).toMatchObject({ lang: 'en', dir: 'ltr' });
    });

    it('loads a font the language API offers when its locale is selected', async () => {
        vi.stubGlobal('localStorage', { getItem: () => null });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
            JSON.stringify({ languages: ['en', 'ar'], fonts: ['ar'] }),
            { headers: { 'Content-Type': 'application/json' } },
        )));
        const load = vi.spyOn(additionalFonts, 'load').mockResolvedValue();
        expect(await fetchEnabledLanguages()).toEqual(['en', 'ar']);
        await loadLocale('AR');
        expect(load).toHaveBeenCalledWith('ar');
        expect(i18n.language).toBe('ar');
    });
});

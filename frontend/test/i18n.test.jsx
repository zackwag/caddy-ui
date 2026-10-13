import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, { availableLocales, fetchEnabledLanguages, loadLocale } from '../src/i18n/index.js';

describe('i18n integration', () => {
    afterEach(async () => {
        vi.unstubAllGlobals();
        await loadLocale('en');
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
});

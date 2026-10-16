import { afterEach, describe, expect, it } from 'vitest';
import { getAvailableFonts, getAdditionalLanguages, getEnabledLanguages, normalizeLanguageSetting } from '../src/languages.js';

const ORIGINAL_LANGUAGES = process.env.CADDY_UI_ADDITIONAL_LANGUAGES;

afterEach(() => {
    if (ORIGINAL_LANGUAGES === undefined) delete process.env.CADDY_UI_ADDITIONAL_LANGUAGES;
    else process.env.CADDY_UI_ADDITIONAL_LANGUAGES = ORIGINAL_LANGUAGES;
});

describe('language configuration', () => {
    it('enables reviewed English, Arabic, and German without opt-in', () => {
        delete process.env.CADDY_UI_ADDITIONAL_LANGUAGES;

        expect(getAdditionalLanguages()).toEqual([]);
        expect(getEnabledLanguages()).toEqual(['en', 'ar', 'de']);
        expect(normalizeLanguageSetting('AR')).toBe('ar');
        expect(normalizeLanguageSetting(' DE ')).toBe('de');
        expect(normalizeLanguageSetting('es-mx')).toBeUndefined();
    });

    it('normalizes, deduplicates, and enables configured ISO 639 language codes', () => {
        process.env.CADDY_UI_ADDITIONAL_LANGUAGES = 'DE, fr, FR, de, en, AR';

        expect(getAdditionalLanguages()).toEqual(['fr']);
        expect(getEnabledLanguages()).toEqual(['en', 'ar', 'de', 'fr']);
    });

    it('accepts region subtags and ignores invalid language values', () => {
        process.env.CADDY_UI_ADDITIONAL_LANGUAGES = 'de-DE, es-MX, 1x, german, , de';

        expect(getAdditionalLanguages()).toEqual(['de-de', 'es-mx']);
    });

    it('exposes bundled fonts for enabled languages automatically', () => {
        delete process.env.CADDY_UI_ADDITIONAL_LANGUAGES;
        expect(getAvailableFonts()).toEqual(['ar']);
        expect(getEnabledLanguages()).toEqual(['en', 'ar', 'de']);
    });

    it('accepts only null or an enabled language as the saved language setting', () => {
        process.env.CADDY_UI_ADDITIONAL_LANGUAGES = 'fr';

        expect(normalizeLanguageSetting(null)).toBeNull();
        expect(normalizeLanguageSetting(' DE ')).toBe('de');
        expect(normalizeLanguageSetting('en')).toBe('en');
        expect(normalizeLanguageSetting('fr')).toBe('fr');
        expect(normalizeLanguageSetting('es-mx')).toBeUndefined();
        expect(normalizeLanguageSetting(1)).toBeUndefined();
        expect(normalizeLanguageSetting({})).toBeUndefined();
    });
});

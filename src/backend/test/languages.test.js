import { afterEach, describe, expect, it } from 'vitest';
import { getAvailableFonts, getAdditionalLanguages, getEnabledLanguages, normalizeLanguageSetting } from '../src/languages.js';

const ORIGINAL_LANGUAGES = process.env.CADDY_UI_ADDITIONAL_LANGUAGES;

afterEach(() => {
    if (ORIGINAL_LANGUAGES === undefined) delete process.env.CADDY_UI_ADDITIONAL_LANGUAGES;
    else process.env.CADDY_UI_ADDITIONAL_LANGUAGES = ORIGINAL_LANGUAGES;
});

describe('language configuration', () => {
    it('enables reviewed English and Arabic without exposing the German preview', () => {
        delete process.env.CADDY_UI_ADDITIONAL_LANGUAGES;

        expect(getAdditionalLanguages()).toEqual([]);
        expect(getEnabledLanguages()).toEqual(['en', 'ar']);
        expect(normalizeLanguageSetting('AR')).toBe('ar');
        expect(normalizeLanguageSetting('de')).toBeUndefined();
    });

    it('normalizes, deduplicates, and enables configured ISO 639 language codes', () => {
        process.env.CADDY_UI_ADDITIONAL_LANGUAGES = 'DE, fr, de, en, AR';

        expect(getAdditionalLanguages()).toEqual(['de', 'fr']);
        expect(getEnabledLanguages()).toEqual(['en', 'ar', 'de', 'fr']);
    });

    it('ignores invalid language values', () => {
        process.env.CADDY_UI_ADDITIONAL_LANGUAGES = 'de-DE, 1x, german, , de';

        expect(getAdditionalLanguages()).toEqual(['de']);
    });

    it('exposes bundled fonts for enabled languages automatically', () => {
        delete process.env.CADDY_UI_ADDITIONAL_LANGUAGES;
        expect(getAvailableFonts()).toEqual(['ar']);
        expect(getEnabledLanguages()).toEqual(['en', 'ar']);
    });

    it('accepts only null or an enabled language as the saved language setting', () => {
        process.env.CADDY_UI_ADDITIONAL_LANGUAGES = 'de';

        expect(normalizeLanguageSetting(null)).toBeNull();
        expect(normalizeLanguageSetting(' DE ')).toBe('de');
        expect(normalizeLanguageSetting('en')).toBe('en');
        expect(normalizeLanguageSetting('fr')).toBeUndefined();
        expect(normalizeLanguageSetting(1)).toBeUndefined();
        expect(normalizeLanguageSetting({})).toBeUndefined();
    });
});

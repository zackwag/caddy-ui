import { afterEach, describe, expect, it } from 'vitest';
import { getAdditionalFonts, getAdditionalLanguages, getEnabledLanguages, normalizeLanguageSetting } from '../src/languages.js';

const ORIGINAL_LANGUAGES = process.env.CADDY_UI_ADDITIONAL_LANGUAGES;
const ORIGINAL_FONTS = process.env.CADDY_UI_ADDITIONAL_FONTS;

afterEach(() => {
    if (ORIGINAL_LANGUAGES === undefined) delete process.env.CADDY_UI_ADDITIONAL_LANGUAGES;
    else process.env.CADDY_UI_ADDITIONAL_LANGUAGES = ORIGINAL_LANGUAGES;
    if (ORIGINAL_FONTS === undefined) delete process.env.CADDY_UI_ADDITIONAL_FONTS;
    else process.env.CADDY_UI_ADDITIONAL_FONTS = ORIGINAL_FONTS;
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

    it('does not load additional fonts by default or through the language opt-in', () => {
        delete process.env.CADDY_UI_ADDITIONAL_FONTS;
        process.env.CADDY_UI_ADDITIONAL_LANGUAGES = 'ar,de';
        expect(getAdditionalFonts()).toEqual([]);
        expect(getEnabledLanguages()).toEqual(['en', 'ar', 'de']);
    });

    it('normalizes font opt-ins and ignores unsupported fonts without enabling previews', () => {
        delete process.env.CADDY_UI_ADDITIONAL_LANGUAGES;
        process.env.CADDY_UI_ADDITIONAL_FONTS = ' AR,ar, en, de, ar-SA, invalid ';
        expect(getAdditionalFonts()).toEqual(['ar']);
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

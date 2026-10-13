import { afterEach, describe, expect, it } from 'vitest';
import { getAdditionalLanguages, getEnabledLanguages, normalizeLanguageSetting } from '../src/languages.js';

const ORIGINAL_LANGUAGES = process.env.CADDY_UI_ADDITIONAL_LANGUAGES;

afterEach(() => {
    if (ORIGINAL_LANGUAGES === undefined) delete process.env.CADDY_UI_ADDITIONAL_LANGUAGES;
    else process.env.CADDY_UI_ADDITIONAL_LANGUAGES = ORIGINAL_LANGUAGES;
});

describe('language configuration', () => {
    it('keeps English enabled when no additional languages are configured', () => {
        delete process.env.CADDY_UI_ADDITIONAL_LANGUAGES;

        expect(getAdditionalLanguages()).toEqual([]);
        expect(getEnabledLanguages()).toEqual(['en']);
    });

    it('normalizes, deduplicates, and enables configured ISO 639 language codes', () => {
        process.env.CADDY_UI_ADDITIONAL_LANGUAGES = 'DE, fr, de, en';

        expect(getAdditionalLanguages()).toEqual(['de', 'fr']);
        expect(getEnabledLanguages()).toEqual(['en', 'de', 'fr']);
    });

    it('ignores invalid language values', () => {
        process.env.CADDY_UI_ADDITIONAL_LANGUAGES = 'de-DE, 1x, german, , de';

        expect(getAdditionalLanguages()).toEqual(['de']);
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

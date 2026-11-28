import { afterEach, describe, expect, it } from 'vitest';
import { getAvailableFonts, getAdditionalLanguages, getEnabledLanguages, normalizeLanguageSetting } from '../src/languages.js';

const ORIGINAL_LANGUAGES = process.env.CADDY_UI_ADDITIONAL_LANGUAGES;

afterEach(() => {
    if (ORIGINAL_LANGUAGES === undefined) {
        delete process.env.CADDY_UI_ADDITIONAL_LANGUAGES;
    } else {
        process.env.CADDY_UI_ADDITIONAL_LANGUAGES = ORIGINAL_LANGUAGES;
    }
});

describe('language configuration', () => {
    it('always enables English, and nothing beyond the reviewed set without opt-in', () => {
        delete process.env.CADDY_UI_ADDITIONAL_LANGUAGES;

        expect(getAdditionalLanguages()).toEqual([]);
        expect(getEnabledLanguages()).toContain('en');
        expect(normalizeLanguageSetting(' EN ')).toBe('en');
        expect(normalizeLanguageSetting('es-mx')).toBeUndefined();
    });

    it('appends configured languages lowercased and deduplicated, skipping ones already enabled', () => {
        delete process.env.CADDY_UI_ADDITIONAL_LANGUAGES;
        const reviewed = getEnabledLanguages();
        process.env.CADDY_UI_ADDITIONAL_LANGUAGES = ['FR', 'fr', ...reviewed.map(lang => lang.toUpperCase()), ...reviewed].join(', ');

        expect(getAdditionalLanguages()).toEqual(['fr']);
        expect(getEnabledLanguages()).toEqual([...reviewed, 'fr']);
    });

    it('accepts region subtags and ignores invalid language values', () => {
        process.env.CADDY_UI_ADDITIONAL_LANGUAGES = 'de-DE, es-MX, 1x, german, , de';

        expect(getAdditionalLanguages()).toEqual(['de-de', 'es-mx']);
    });

    it.each([undefined, 'fr'])('exposes bundled fonts only for enabled languages (additional: %s)', additional => {
        if (additional === undefined) {
            delete process.env.CADDY_UI_ADDITIONAL_LANGUAGES;
        } else {
            process.env.CADDY_UI_ADDITIONAL_LANGUAGES = additional;
        }
        expect(getEnabledLanguages()).toEqual(expect.arrayContaining(getAvailableFonts()));
    });

    it('accepts only null or an enabled language as the saved language setting', () => {
        process.env.CADDY_UI_ADDITIONAL_LANGUAGES = 'fr';

        expect(normalizeLanguageSetting(null)).toBeNull();
        expect(normalizeLanguageSetting(' FR ')).toBe('fr');
        expect(normalizeLanguageSetting('en')).toBe('en');
        expect(normalizeLanguageSetting('es-mx')).toBeUndefined();
        expect(normalizeLanguageSetting(1)).toBeUndefined();
        expect(normalizeLanguageSetting({})).toBeUndefined();
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import LanguagePicker from '../src/components/LanguagePicker.jsx';
import i18n, { availableLocales, fetchEnabledLanguages, loadLocale } from '../src/i18n/index.js';

describe('i18n integration', () => {
    afterEach(async () => {
        vi.unstubAllGlobals();
        await loadLocale('en');
    });

    it('switches from English to a lazy-loaded German catalog through the language picker', async () => {
        const changeLanguage = async (lang) => {
            await loadLocale(lang);
        };

        const picker = LanguagePicker({
            languages: ['en', 'de'],
            language: 'en',
            onLanguageChange: changeLanguage,
        });

        expect(picker.type).toBe('select');
        expect(picker.props.children.map(option => option.props.value)).toEqual(['en', 'de']);
        expect(i18n.t('test.languageLoaded')).toBe('English loaded');

        await picker.props.onChange({ target: { value: 'de' } });

        expect(i18n.language).toBe('de');
        expect(i18n.t('test.languageLoaded')).toBe('Deutsch geladen');
        expect(i18n.t('common.save')).toBe('Save');
    });

    it('loads the probe key for every installed locale advertised by the language API', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            json: async () => ({ languages: [...availableLocales, 'zz'] }),
        })));

        const enabled = await fetchEnabledLanguages('/api');

        expect(enabled).toEqual(availableLocales);
        expect(fetch).toHaveBeenCalledWith('/api/languages');

        for (const locale of enabled) {
            await loadLocale(locale);
            const probe = i18n.t('test.languageLoaded');

            expect(probe).toBeTruthy();
            expect(probe).not.toBe('test.languageLoaded');
        }
    });
});

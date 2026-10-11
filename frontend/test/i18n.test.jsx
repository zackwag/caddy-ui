import { afterEach, describe, expect, it } from 'vitest';
import LanguagePicker from '../src/components/LanguagePicker.jsx';
import i18n, { loadLocale } from '../src/i18n/index.js';

describe('i18n integration', () => {
    afterEach(async () => {
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
});

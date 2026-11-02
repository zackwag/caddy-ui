import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { apiFetch } from '../utils/api.js';
import en from './locales/en.js';
import { additionalFonts } from './fonts.js';

const localeModules = import.meta.glob([
    './locales/*.js',
    '!./locales/en.js',
]);

export const availableLocales = [
    'en',
    ...Object.keys(localeModules)
        .map(path => path.match(/\/([^/]+)\.js$/)?.[1])
        .filter(Boolean),
];

export function languageName(locale) {
    try {
        return new Intl.DisplayNames([locale], { type: 'language' }).of(locale);
    } catch {
        return locale.toUpperCase();
    }
}

// Keep the browser's writing direction in sync even on the login screen,
// during initial locale detection, and when falling back to English.
i18n.on('languageChanged', language => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = language;
    document.documentElement.dir = i18n.dir(language);
});

i18n
    .use(initReactI18next)
    .init({
        lng: 'en',
        fallbackLng: 'en',
        // Match regional resource lookups to the lowercase catalog filenames.
        lowerCaseLng: true,
        resources: {
            en: {
                translation: en,
            },
        },
        interpolation: {
            escapeValue: false,
        },
    });

export async function fetchEnabledLanguages() {
    const languageConfig = await apiFetch('/languages');

    const available = new Set(availableLocales);
    const enabled = (
        Array.isArray(languageConfig.languages)
            ? languageConfig.languages
            : ['en']
    ).filter(lang => available.has(lang));

    if (!enabled.includes('en')) enabled.unshift('en');
    additionalFonts.configure(Array.isArray(languageConfig.fonts)
        ? languageConfig.fonts.filter(locale => enabled.includes(locale)) : []);
    return enabled;
}

export async function loadLocale(locale) {
    const normalized = locale.toLowerCase();

    if (normalized === 'en') {
        await i18n.changeLanguage('en');
        return;
    }

    const path = `./locales/${normalized}.js`;
    const loader = localeModules[path];

    if (!loader) {
        await i18n.changeLanguage('en');
        return;
    }

    if (!i18n.hasResourceBundle(normalized, 'translation')) {
        const module = await loader();
        i18n.addResourceBundle(
            normalized,
            'translation',
            module.default,
            true,
            true,
        );
    }

    await additionalFonts.load(normalized);
    await i18n.changeLanguage(normalized);
}

export function resolveLocale(enabledLanguages, savedLanguage = null) {
    const enabled = new Set(enabledLanguages);

    if (typeof savedLanguage === 'string' && enabled.has(savedLanguage.toLowerCase())) {
        return savedLanguage.toLowerCase();
    }

    for (const browserLocale of navigator.languages || [navigator.language]) {
        const language = browserLocale.toLowerCase().split('-')[0];

        if (enabled.has(language)) {
            return language;
        }
    }

    return 'en';
}

export default i18n;

import i18n from '../i18n/index.js';

// The active UI language for toLocale*/Intl formatting. Components re-render on
// a language switch through useTranslation, so calling this while rendering
// keeps dates and numbers in step with the translated text.
export function currentLocale() {
    return i18n.resolvedLanguage || i18n.language;
}

export function formatTs(timestamp) {
    const ts = timestamp.endsWith('Z') ? timestamp : timestamp + 'Z';
    return new Date(ts).toLocaleString(currentLocale(), {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

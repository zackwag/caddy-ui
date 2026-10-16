import i18n from '../i18n/index.js';

// The active UI language for toLocale*/Intl formatting. Components re-render on
// a language switch through useTranslation, so calling this while rendering
// keeps dates and numbers in step with the translated text.
export function currentLocale() {
    return i18n.resolvedLanguage || i18n.language;
}

// Digit grouping and decimal separator for the UI language; non-numbers pass
// through so a missing field renders as before instead of throwing.
export function formatNumber(value) {
    return typeof value === 'number' ? value.toLocaleString(currentLocale()) : value;
}

const percentFormat = () => new Intl.NumberFormat(currentLocale(), { style: 'percent', maximumFractionDigits: 1 });

// A 0-100 percentage in the UI language's style: "99.9%", "99,9 %", "%99,9".
export function formatPercent(value) {
    return typeof value === 'number' ? percentFormat().format(value / 100) : value;
}

// formatPercent split into { text, isSign } runs, for layouts that style the
// percent sign separately from the number. Literal parts only ever surround
// the sign (German's space, bidi marks), so they're styled with it.
export function formatPercentParts(value) {
    const runs = [];
    for (const part of percentFormat().formatToParts(value / 100)) {
        const isSign = part.type === 'percentSign' || part.type === 'literal';
        const last = runs[runs.length - 1];
        if (last && last.isSign === isSign) last.text += part.value;
        else runs.push({ text: part.value, isSign });
    }
    return runs;
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

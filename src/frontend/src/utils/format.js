import i18n from '../i18n/index.js';

// The active UI language for toLocale*/Intl formatting. Components re-render on
// a language switch through useTranslation, so calling this while rendering
// keeps dates and numbers in step with the translated text.
function currentLocale() {
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
    return new Date(timestamp).toLocaleString(currentLocale(), { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// A moment recent enough that its year is obvious
export function formatRecentTs(timestamp) {
    return new Date(timestamp).toLocaleString(currentLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* eslint-disable i18next/no-literal-string -- Intl unit option identifiers; Intl supplies the localized labels. */
export function formatDuration(ms) {
    const seconds = ms / 1000;
    const [value, unit] = seconds >= 86400 ? [seconds / 86400, 'day']
        : seconds >= 3600 ? [seconds / 3600, 'hour']
            : seconds >= 60 ? [seconds / 60, 'minute'] : [seconds, 'second'];
    return new Intl.NumberFormat(currentLocale(), { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: unit === 'second' ? 0 : 1 }).format(value);
}
/* eslint-enable i18next/no-literal-string */

export function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString(currentLocale(), { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

// The language's full date and time
export function formatDateTime(timestamp) {
    return new Date(timestamp).toLocaleString(currentLocale());
}

export function formatSecondsTs(timestamp) {
    return new Date(timestamp).toLocaleString(currentLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

// A chart axis label: the day for a range over a day, otherwise the time
export function formatAxisTime(timestamp, rangeMs) {
    const date = new Date(timestamp);
    return rangeMs > 24 * 60 * 60 * 1000
        ? date.toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric' })
        : date.toLocaleTimeString(currentLocale(), { hour: 'numeric', minute: '2-digit' });
}

export function formatRelativeTime(timestamp, t) {
    const diffSec = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (diffSec < 5) return t('routeHistory.justNow');
    if (diffSec < 60) return t('routeHistory.secondsAgo', { count: diffSec });
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return t('routeHistory.minutesAgo', { count: diffMin });
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return t('routeHistory.hoursAgo', { count: diffHr });
    return t('routeHistory.daysAgo', { count: Math.round(diffHr / 24) });
}

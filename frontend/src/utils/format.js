export function formatTs(timestamp, locale) {
    const ts = timestamp.endsWith('Z') ? timestamp : timestamp + 'Z';
    return new Date(ts).toLocaleString(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

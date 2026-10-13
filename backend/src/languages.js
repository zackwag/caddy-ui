export function getAdditionalLanguages() {
    const raw = process.env.CADDY_UI_ADDITIONAL_LANGUAGES || '';

    return [...new Set(
        raw
            .split(',')
            .map(lang => lang.trim().toLowerCase())
            .filter(lang => /^[a-z]{2,3}$/.test(lang))
            .filter(lang => lang !== 'en')
    )];
}

export function getEnabledLanguages() {
    return ['en', ...getAdditionalLanguages()];
}

// Normalizes a `language` setting from PUT /api/settings. Returns null to clear
// it, the lowercase code if it's enabled, or undefined if it's not acceptable.
export function normalizeLanguageSetting(value) {
    if (value === null) return null;
    if (typeof value !== 'string') return undefined;
    const lang = value.trim().toLowerCase();
    return getEnabledLanguages().includes(lang) ? lang : undefined;
}

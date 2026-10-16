// Admission is an explicit review decision, independent of catalog coverage.
export const REVIEWED_LANGUAGES = Object.freeze(['en', 'ar', 'de']);
const FONT_LANGUAGES = ['ar'];

function parseCodes(raw = '') {
    return [...new Set(
        raw
            .split(',')
            .map(lang => lang.trim().toLowerCase())
            .filter(lang => /^[a-z]{2,3}(-[a-z]{2})?$/.test(lang))
    )];
}

export function getAdditionalLanguages() {
    return parseCodes(process.env.CADDY_UI_ADDITIONAL_LANGUAGES)
        .filter(lang => !REVIEWED_LANGUAGES.includes(lang));
}

export function getEnabledLanguages() {
    return [...REVIEWED_LANGUAGES, ...getAdditionalLanguages()];
}

export function getAvailableFonts() {
    const enabled = getEnabledLanguages();
    return FONT_LANGUAGES.filter(lang => enabled.includes(lang));
}

// Normalizes a `language` setting from PUT /api/settings. Returns null to clear
// it, the lowercase code if it's enabled, or undefined if it's not acceptable.
export function normalizeLanguageSetting(value) {
    if (value === null) return null;
    if (typeof value !== 'string') return undefined;
    const lang = value.trim().toLowerCase();
    return getEnabledLanguages().includes(lang) ? lang : undefined;
}

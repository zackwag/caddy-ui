// Optional font failures must not prevent a catalog or its system fallback loading.
export function createFontLoader(loaders, warn = console.warn) {
    let enabled = new Set();
    const loaded = new Map();
    return {
        configure(fonts) {
            enabled = new Set(Array.isArray(fonts) ? fonts.filter(font => Object.hasOwn(loaders, font)) : []);
        },
        async load(locale) {
            if (!enabled.has(locale)) return;
            if (!loaded.has(locale)) loaded.set(locale, Promise.resolve().then(() => loaders[locale]()));
            const pending = loaded.get(locale);
            try { await pending; }
            catch (error) {
                // Only the owner clears/reports a failed shared request; selection can retry.
                if (loaded.get(locale) === pending) {
                    loaded.delete(locale);
                    warn('Optional UI font could not be loaded; using system fallback.', error);
                }
            }
        },
    };
}

export const additionalFonts = createFontLoader({
    ar: () => import('./fonts/arabic.css'),
});

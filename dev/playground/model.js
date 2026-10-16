import { createInstance } from 'i18next';

export function flattenCatalog(catalog, prefix = '') {
    return Object.entries(catalog).flatMap(([name, value]) => {
        const key = prefix ? `${prefix}.${name}` : name;
        return typeof value === 'string' ? [[key, value]] : flattenCatalog(value, key);
    });
}

export function readValue(catalog, key) {
    return key.split('.').reduce((value, part) => value?.[part], catalog);
}

export function placeholders(value) {
    return [...value.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((match) => match[1]).sort();
}

export async function createPreviewI18n(catalogs, locale, overrides = {}) {
    const instance = createInstance();
    await instance.init({
        lng: locale,
        fallbackLng: 'en',
        resources: Object.fromEntries(
            Object.entries(catalogs).map(([code, catalog]) => [
                code,
                { translation: structuredClone(catalog) },
            ]),
        ),
        interpolation: { escapeValue: false },
        react: { useSuspense: false, bindI18nStore: 'added removed' },
    });
    for (const [key, value] of Object.entries(overrides)) {
        instance.addResource(locale, 'translation', key, value);
    }
    return instance;
}

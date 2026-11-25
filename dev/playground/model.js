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

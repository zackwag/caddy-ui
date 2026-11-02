const stable = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/;
const development = /^(dev|edge|beta)(?:-[a-f0-9]+)?$/;

export function releaseNotes(catalog, tag) {
    return `https://github.com/${catalog.repository}/releases/tag/${encodeURIComponent(tag)}`;
}

// The catalogue is published newest first. Keep Development beside the latest
// release rather than ahead of the release documentation most readers need.
export function documentationOptions(catalog) {
    const [latest, ...older] = catalog.releases;
    const option = release => [release.tag, release.tag + (release.snapshot ? '' : ' (release notes)')];
    return [...(latest ? [option(latest)] : []), ['dev', 'Development'], ...older.map(option)];
}

export function defaultDocumentation(catalog, options) {
    const latest = catalog.releases.find(release => release.snapshot && catalog.books[release.snapshot]);
    return latest ? documentationTarget(catalog, latest.tag, options) : null;
}

// Both the selector and installed-version resolver use this policy. A missing
// historical book never silently becomes development documentation.
export function documentationTarget(catalog, value, { component, page = 'index.html', hash = '' } = {}) {
    if (typeof value !== 'string') return null;
    let book, tag, entry;
    if (development.test(value)) {
        book = catalog.development;
        tag = 'dev';
    } else if (stable.test(value)) {
        tag = value.startsWith('v') ? value : `v${value}`;
        entry = catalog.releases.find(release => release.tag === tag);
        if (!entry?.snapshot || component && entry.images[component]?.version !== tag.slice(1)) {
            return { kind: 'notes', tag, href: entry ? releaseNotes(catalog, tag) : `https://github.com/${catalog.repository}/releases` };
        }
        book = catalog.books[entry.snapshot];
    } else return null;
    const available = book.pages.includes(page);
    const target = available ? page : 'index.html';
    const query = new URLSearchParams({ version: tag });
    if (!available) query.set('missing', page);
    const fragment = available && hash ? '#' + hash.replace(/^#/, '') : '';
    return { kind: 'book', tag, href: book.path + target.split('/').map(encodeURIComponent).join('/') + '?' + query + fragment };
}

export function resolveDocumentation(catalog, parameters, hash = '') {
    const version = parameters.get('version');
    const requested = ['frontend', 'backend'].filter(component => parameters.has(component));
    if (version && requested.length) return { kind: 'invalid' };
    const options = { page: parameters.get('page') || 'index.html', hash };
    if (version) {
        const target = documentationTarget(catalog, version, options);
        return target ? { kind: 'redirect', target } : { kind: 'invalid' };
    }
    if (!requested.length) return { kind: 'empty' };
    const choices = requested.map(component => ({ component, version: parameters.get(component),
        target: documentationTarget(catalog, parameters.get(component), { ...options, component }) }));
    if (choices.some(choice => !choice.target)) return { kind: 'invalid' };
    if (choices.length === 1 || choices.every(choice => choice.target.href === choices[0].target.href)) {
        return { kind: 'redirect', target: choices[0].target };
    }
    return { kind: 'choose', choices };
}

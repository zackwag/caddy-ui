import { defaultDocumentation, documentationOptions, documentationTarget } from './versions-model.js';

const site = new URL('../', import.meta.url);
const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
};

async function showVersions() {
    const script = document.querySelector('script[data-docs-book]');
    const sidebar = document.querySelector('.sidebar-scrollbox');
    if (!script || !sidebar) return;
    const box = element('div', '', 'docs-version-box');
    const label = element('label', 'Documentation version');
    label.className = 'docs-version-label';
    label.htmlFor = 'docs-version';
    const select = element('select');
    select.id = 'docs-version';
    const control = element('div', '', 'docs-version-select');
    control.append(select);
    const note = element('p', '', 'docs-version-note');
    note.id = 'docs-version-note';
    note.hidden = true;
    select.setAttribute('aria-describedby', note.id);
    box.append(label, control, note);
    let footer = sidebar.parentElement.querySelector('.sidebar-footer');
    if (!footer) {
        footer = element('div', '', 'sidebar-footer');
        const license = element('a', 'MIT License');
        license.href = 'https://github.com/zackwag/caddy-ui/blob/main/LICENSE';
        footer.append(license);
        sidebar.after(footer);
    }
    footer.classList.add('docs-sidebar-footer');
    footer.prepend(box);
    try {
        const response = await fetch(new URL('documentation.json', site), { cache: 'no-cache' });
        if (!response.ok) throw new Error('Catalogue unavailable');
        const catalog = await response.json();
        if (catalog.schema !== 1) throw new Error('Unsupported catalogue');
        const book = script.dataset.docsBook;
        const parameters = new URLSearchParams(location.search);
        const bookRoot = new URL(script.dataset.docsBase, site);
        const page = decodeURIComponent(location.pathname.slice(bookRoot.pathname.length)) || 'index.html';
        // Keep explicit Development and archived-book URLs stable. Only bare
        // root chapter URLs default to a collected release, retaining chapters
        // and anchors when that release contains them.
        if (book === 'development' && script.dataset.docsBase === '' && !parameters.has('version')) {
            const target = defaultDocumentation(catalog, { page, hash: location.hash });
            if (target) {
                const destination = new URL(target.href, site);
                for (const [key, value] of parameters) {
                    if (!destination.searchParams.has(key)) destination.searchParams.append(key, value);
                }
                location.replace(destination);
                return;
            }
        }
        const matching = catalog.releases.filter(release => release.snapshot === book);
        const current = book === 'development' ? 'dev'
            : matching.find(release => release.tag === parameters.get('version'))?.tag || matching[0]?.tag;
        if (!current) throw new Error('Book is absent from catalogue');
        for (const [value, title] of documentationOptions(catalog)) {
            const option = element('option', title);
            option.value = value;
            select.append(option);
        }
        select.value = current;
        note.textContent = current === 'dev' ? 'May include features not available in a released version.'
            : matching.length > 1 ? `This book is shared by ${matching.length} releases.` : 'Documentation for this release.';
        if (parameters.has('missing')) {
            note.textContent = 'That page is not available in this version. Showing its home page.';
            note.hidden = false;
        }
        select.title = note.textContent;
        const title = document.querySelector('.menu-title');
        const badge = element('span', current === 'dev' ? 'Development' : current, 'docs-version-badge');
        if (current === 'dev') badge.classList.add('docs-version-development');
        if (title) title.after(badge);
        document.title = `${current === 'dev' ? 'Development' : current} · ${document.title}`;
        select.addEventListener('change', () => {
            const target = documentationTarget(catalog, select.value, { page, hash: location.hash });
            if (target) location.assign(new URL(target.href, site));
        });
        // Keep the selected release when several versions share one book,
        // including mdBook's keyboard navigation and generated search links.
        const pages = book === 'development' ? catalog.development.pages : catalog.books[book].pages;
        const preserve = container => {
            const here = new URL(location.href);
            for (const link of container.querySelectorAll('a[href]')) {
                const url = new URL(link.href, location.href);
                if (url.origin !== bookRoot.origin || !url.pathname.startsWith(bookRoot.pathname)) continue;
                if (!pages.includes(decodeURIComponent(url.pathname.slice(bookRoot.pathname.length)))) continue;
                if (url.pathname === here.pathname && url.search === here.search) {
                    continue;
                }
                url.searchParams.set('version', current);
                link.href = url.href;
            }
        };
        preserve(document);
        const search = document.getElementById('mdbook-searchresults');
        if (search) new MutationObserver(() => preserve(search)).observe(search, { childList: true, subtree: true });
    } catch {
        control.remove();
        note.hidden = false;
        note.textContent = 'Other versions could not be loaded. This page is still available.';
    }
}

void showVersions();

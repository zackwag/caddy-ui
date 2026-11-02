(() => {
    const scrollbox = document.querySelector('.sidebar-scrollbox');
    if (!scrollbox || scrollbox.querySelector('.sidebar-brand')) return;

    const brand = document.createElement('a');
    brand.className = 'sidebar-brand';
    // mdBook provides a path relative to each page, including nested chapters.
    brand.href = `${typeof path_to_root === 'string' ? path_to_root : './'}index.html`;
    brand.setAttribute('aria-label', 'caddy/ui documentation home');
    const mark = document.createElement('span');
    mark.className = 'sidebar-wordmark';
    mark.textContent = 'caddy/ui';
    const subtitle = document.createElement('span');
    subtitle.className = 'sidebar-brand-subtitle';
    subtitle.textContent = 'Documentation';
    brand.append(mark, subtitle);
    scrollbox.prepend(brand);

    const footer = document.createElement('div');
    footer.className = 'sidebar-footer';
    const license = document.createElement('a');
    license.href = 'https://github.com/zackwag/caddy-ui/blob/main/LICENSE';
    license.textContent = 'MIT License';
    footer.append(license);
    scrollbox.after(footer);
})();

(() => {
    function keepScrollKeys(event) {
        const element = event.currentTarget;
        // mdBook uses left/right arrows for chapter navigation. Keep the
        // browser's native scrolling when a focused diagram or table overflows.
        if (['ArrowLeft', 'ArrowRight'].includes(event.key) && element.scrollWidth > element.clientWidth) {
            event.stopPropagation();
        }
    }
    document.querySelectorAll('.docs-architecture-reference .table-wrapper, .docs-environment-variables .table-wrapper').forEach(element => {
        element.tabIndex = 0;
        element.setAttribute('role', 'region');
        element.setAttribute('aria-label', element.closest('.docs-environment-variables') ? 'Environment variables' : 'Service responsibilities');
        element.addEventListener('keydown', keepScrollKeys);
    });
    // Prefer breaks between URL components without adding characters to copied values.
    document.querySelectorAll('.docs-environment-variables td:nth-child(2) code').forEach(code => {
        const value = code.textContent;
        if (!/^https?:\/\//.test(value)) return;
        const start = value.indexOf('://') + 3;
        const parts = [value.slice(0, start), ...value.slice(start).split(/(?=\/)/)];
        code.replaceChildren();
        parts.forEach((part, index) => {
            if (index) code.append(document.createElement('wbr'));
            code.append(part);
        });
    });
    const diagrams = [...document.querySelectorAll('pre > code.language-mermaid')].map(code => {
        const element = document.createElement('div');
        element.className = 'mermaid';
        element.tabIndex = 0;
        element.setAttribute('role', 'region');
        element.setAttribute('aria-label', 'Scrollable diagram');
        element.addEventListener('keydown', keepScrollKeys);
        const source = code.textContent;
        code.parentElement.replaceWith(element);
        return { element, source };
    });
    if (!diagrams.length) return;

    let rendering = false;
    let pending = false;
    function currentTheme() {
        return ['navy', 'coal', 'ayu'].some(theme => document.documentElement.classList.contains(theme)) ? 'dark' : 'default';
    }
    let theme = currentTheme();

    async function render() {
        pending = true;
        if (rendering) return;
        rendering = true;
        try {
            while (pending) {
                pending = false;
                window.mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: 'strict',
                    theme: currentTheme(),
                    fontFamily: 'ui-monospace, monospace',
                    themeVariables: { fontSize: '16px' },
                    flowchart: {
                        useMaxWidth: false,
                        minNodeWidth: 180,
                        wrappingWidth: 240,
                        nodeSpacing: 40,
                        rankSpacing: 50,
                        curve: 'linear',
                    },
                    suppressErrorRendering: true,
                });
                for (const { element, source } of diagrams) {
                    element.removeAttribute('data-processed');
                    element.textContent = source;
                    try {
                        await window.mermaid.run({ nodes: [element] });
                    } catch (error) {
                        // Keep source readable when a diagram is invalid.
                        const pre = document.createElement('pre');
                        const code = document.createElement('code');
                        code.textContent = source;
                        pre.append(code);
                        element.replaceChildren(pre);
                        console.error('Could not render Mermaid diagram:', error);
                    }
                }
            }
        } finally {
            rendering = false;
        }
    }
    new MutationObserver(() => {
        const nextTheme = currentTheme();
        if (nextTheme !== theme) {
            theme = nextTheme;
            void render();
        }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    void render();
})();

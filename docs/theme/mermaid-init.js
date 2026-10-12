(() => {
    const diagrams = [...document.querySelectorAll('pre > code.language-mermaid')].map(code => {
        const element = document.createElement('div');
        element.className = 'mermaid';
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

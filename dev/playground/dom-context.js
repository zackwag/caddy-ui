export function visibleText(value) {
    return (value || '').replace(/<\/?(?:code|strong|b|em|i|\d+)>/g, '').replace(/\s+/g, ' ').trim();
}

// Runtime observations are matched to real text/attributes. Wording shared by
// different keys is reported as ambiguous, never treated as proof of a mapping.
export function markReferences(root, selected, observations) {
    for (const element of root.querySelectorAll('[data-preview-key]')) {
        element.removeAttribute('data-preview-key');
        element.removeAttribute('data-preview-match');
        element.removeAttribute('data-preview-ambiguous');
    }
    const selectedValues = new Set(observations.filter(record => record.key === selected).map(record => visibleText(record.value)).filter(Boolean));
    const references = [];
    for (const element of root.querySelectorAll('*')) {
        if (!element.getClientRects().length || ['SCRIPT', 'STYLE'].includes(element.tagName) || getComputedStyle(element).visibility === 'hidden') continue;
        const attributes = ['placeholder', 'title', 'aria-label'].filter(name => selectedValues.has(visibleText(element.getAttribute(name) || '')));
        const text = visibleText(element.textContent || '');
        const wholeText = selectedValues.has(text) && ![...element.children].some(child => visibleText(child.textContent || '') === text);
        const textValues = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => visibleText(node.textContent)).filter(value => selectedValues.has(value));
        if (wholeText) textValues.push(text);
        const textMatches = textValues.length > 0;
        if (!textMatches && !attributes.length) continue;
        const values = new Set([...textValues, ...attributes.map(name => visibleText(element.getAttribute(name)))]);
        const sharedKeys = [...new Set(observations.filter(record => record.key !== selected && values.has(visibleText(record.value))).map(record => record.key))];
        const index = references.length;
        element.setAttribute('data-preview-key', selected);
        element.setAttribute('data-preview-match', String(index));
        if (sharedKeys.length) element.setAttribute('data-preview-ambiguous', 'true');
        references.push({ tag: element.tagName.toLowerCase(), text: textMatches, textValues: [...new Set(textValues)], attributes, sharedKeys,
            selector: `[data-preview-key="${selected}"][data-preview-match="${index}"]` });
    }
    return references;
}

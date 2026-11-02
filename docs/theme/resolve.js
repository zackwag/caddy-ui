import { documentationTarget, resolveDocumentation } from './versions-model.js';

const site = new URL('../', import.meta.url);
const content = document.getElementById('docs-resolution');
const element = (tag, text) => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
};

async function resolve() {
    try {
        const response = await fetch(new URL('documentation.json', site), { cache: 'no-cache' });
        if (!response.ok) throw new Error('Catalogue unavailable');
        const catalog = await response.json();
        if (catalog.schema !== 1) throw new Error('Unsupported catalogue');
        const parameters = new URLSearchParams(location.search);
        const tag = document.querySelector('script[data-docs-version]').dataset.docsVersion;
        if (tag && !parameters.has('version') && !parameters.has('frontend') && !parameters.has('backend')) parameters.set('version', tag);
        const result = resolveDocumentation(catalog, parameters, location.hash);
        if (result.kind === 'redirect') {
            location.replace(new URL(result.target.href, site));
            return;
        }
        content.replaceChildren();
        if (result.kind === 'choose') {
            content.append(element('p', 'Your frontend and backend need different documentation. Choose the component you are working with.'));
            const list = document.createElement('ul');
            for (const choice of result.choices) {
                const item = document.createElement('li');
                const link = element('a', `${choice.component === 'frontend' ? 'Frontend' : 'Backend'} ${choice.version}`
                    + (choice.target.kind === 'notes' ? ' — release notes' : ' — documentation'));
                link.href = new URL(choice.target.href, site);
                item.append(link); list.append(item);
            }
            content.append(list);
        } else {
            content.append(element('p', result.kind === 'invalid' ? 'The requested version was not recognised. Choose a version below.' : 'Choose a documentation version.'));
        }
        const label = element('label', 'Documentation version ');
        const select = document.createElement('select');
        select.id = 'docs-version';
        label.htmlFor = select.id;
        for (const [value, text] of [['', 'Choose a version…'], ['dev', 'Development'],
            ...catalog.releases.map(release => [release.tag, release.tag + (release.snapshot ? '' : ' (release notes)')])]) {
            const option = element('option', text); option.value = value; select.append(option);
        }
        select.addEventListener('change', () => {
            const target = documentationTarget(catalog, select.value);
            if (target) location.assign(new URL(target.href, site));
        });
        content.append(label, select);
    } catch {
        content.replaceChildren(element('p', 'The version list is unavailable.'));
        const link = element('a', 'Open development documentation');
        link.href = new URL('dev/index.html', site);
        content.append(link);
    }
}

void resolve();

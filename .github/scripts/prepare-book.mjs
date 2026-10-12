import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { THEME_LIST } from '../../frontend/src/styles.js';

const root = new URL('../../', import.meta.url);
const theme = new URL('docs/theme/', root);
await mkdir(theme, { recursive: true });
await cp(new URL('screenshots/', root), new URL('docs/src/screenshots/', root), { recursive: true });
for (const extension of ['ico', 'svg']) {
    await cp(new URL(`frontend/caddyui-logo.${extension}`, root), new URL(`favicon.${extension}`, theme));
}

// Reuse the frontend's actual palette tokens, without importing its app CSS.
// Map each built-in mdBook scheme to the corresponding caddy/ui default.
const schemes = {
    light: 'coarse-everywhere', rust: 'coarse-everywhere',
    navy: 'vt2026', coal: 'vt2026', ayu: 'vt2026',
};
const css = Object.entries(schemes).map(([scheme, id]) => {
    const palette = THEME_LIST.find(entry => entry.id === id);
    if (!palette) throw new Error(`Missing frontend palette: ${id}`);
    const tokens = Object.entries(palette.vars)
        .map(([name, value]) => `    --app-${name.slice(2)}: ${value};`);
    return `.${scheme} {\n${tokens.join('\n')}\n}`;
}).join('\n\n');
await writeFile(new URL('palettes.css', theme), `/* Generated from frontend/src/styles.js. */\n${css}\n`);

// Transitional migration: README.md and CONTRIBUTING.md remain canonical.
// Generate only the book's staging files; Docker Hub routing is unchanged.
for (const [source, output] of [['README.md', 'guide.md'], ['CONTRIBUTING.md', 'contributing.md']]) {
    let markdown = await readFile(new URL(source, root), 'utf8');
    markdown = markdown.replaceAll('](README.md', '](guide.md')
        .replaceAll('](CONTRIBUTING.md', '](contributing.md')
        .replaceAll('](CHANGELOG.md)', '](https://github.com/zackwag/caddy-ui/blob/main/CHANGELOG.md)');
    await writeFile(new URL(`docs/src/${output}`, root), markdown);
}

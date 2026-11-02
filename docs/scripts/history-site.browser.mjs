import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import { options } from './history-inventory.mjs';
import { siteBase } from './history-site.mjs';

const require = createRequire(new URL('../../dev/package.json', import.meta.url));
const { chromium } = require('playwright');
const args = options(process.argv.slice(2), ['site', 'base', 'screenshot', 'mobile-screenshot']);
const directory = resolve(args.site || new URL('../../.docs-site', import.meta.url).pathname);
const base = siteBase(args.base || '/caddy-ui/');
const catalog = JSON.parse(await readFile(join(directory, 'documentation.json'), 'utf8'));
const missing = [], errors = [], notes = [];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://docs.invalid').pathname;
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (!path.startsWith(base)) { missing.push(path); res.writeHead(404).end(); return; }
    try {
        let file = resolve(directory, decodeURIComponent(path.slice(base.length)) || 'index.html');
        if (!file.startsWith(directory + '/') && file !== directory) { res.writeHead(403).end(); return; }
        if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
        res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
    } catch { missing.push(path); res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    const context = await browser.newContext();
    await context.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(origin)) return route.continue();
        if (url.startsWith(`https://github.com/${catalog.repository}/releases/tag/`)) {
            notes.push(url); return route.fulfill({ contentType: 'text/html', body: '<h1>Release notes fixture</h1>' });
        }
        return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const visit = path => page.goto(origin + base + path);
    const newest = catalog.releases.find(release => release.snapshot);
    const oldest = catalog.releases.filter(release => release.snapshot).at(-1);
    await visit('index.html');
    await page.locator('.docs-version-development').waitFor();
    // Bare development anchors must scroll without a document navigation or
    // adding ?version=dev. Check root and /dev/ URLs, since both are public.
    for (const path of ['index.html', 'dev/index.html']) {
        await visit(path);
        await page.locator('.docs-version-development').waitFor();
        const anchor = page.locator('main a.header[href^="#"]').first();
        const href = await anchor.getAttribute('href');
        assert(href?.startsWith('#'), 'same-page anchor keeps its original href');
        await page.evaluate(() => { window.docsAnchorNavigation = true; });
        await anchor.click();
        assert.equal(await page.evaluate(() => window.docsAnchorNavigation), true, 'anchor does not reload the document');
        assert.equal(new URL(page.url()).search, '');
    }
    console.log('Development anchors scroll without reloading or adding a version query');
    await visit('index.html');
    await page.locator('#docs-version').selectOption('dev');
    await page.waitForURL(url => url.pathname.includes('/dev/'));
    await page.locator('.docs-version-development').waitFor();
    console.log('Existing root URLs and labelled development documentation pass');
    for (const release of [oldest, newest]) {
        await visit(`versions/${release.tag}/index.html`);
        await page.waitForURL(url => url.pathname.includes(`/books/${release.snapshot}/`));
        await page.waitForFunction(tag => document.getElementById('docs-version')?.value === tag, release.tag);
        await page.goto(new URL(`books/${release.snapshot}/screenshots.html?version=${release.tag}`, origin + base).href);
        await page.locator('main img:visible').last().scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll('main img')].every(image => image.complete && image.naturalWidth > 0));
        await page.locator('#mdbook-search-toggle').click();
        await page.locator('#mdbook-searchbar').pressSequentially('Caddyfile');
        await page.locator('#mdbook-searchresults a').first().waitFor();
        await page.locator('#mdbook-searchresults a').first().click();
        await page.waitForFunction(tag => new URL(location.href).searchParams.get('version') === tag, release.tag);
        console.log(`${release.tag}: permalink, images, search and selected-version navigation pass`);
    }
    const commonPage = catalog.books[oldest.snapshot].pages.find(name => name !== 'index.html' && name !== '404.html'
        && catalog.books[newest.snapshot].pages.includes(name));
    assert(commonPage, 'old and new books have a chapter in common');
    await visit(`books/${oldest.snapshot}/${commonPage}?version=${oldest.tag}#configuration`);
    await page.locator('#docs-version').selectOption(newest.tag);
    await page.waitForURL(url => url.pathname.endsWith('/' + commonPage) && url.searchParams.get('version') === newest.tag);
    assert.equal(new URL(page.url()).hash, '#configuration');
    await visit(`resolve.html?version=${newest.tag}&page=not-present.html`);
    await page.locator('.docs-version-note').filter({ hasText: 'not available' }).waitFor();
    const shared = catalog.releases.find(release => release.snapshot && catalog.releases.some(other => other.tag !== release.tag && other.snapshot === release.snapshot));
    if (shared) {
        await visit(`books/${shared.snapshot}/index.html?version=${shared.tag}`);
        await page.locator('#docs-version').waitFor();
        await page.locator('.chapter a').nth(1).click();
        await page.waitForFunction(tag => document.getElementById('docs-version')?.value === tag, shared.tag);
    }
    console.log('Chapter/anchor preservation, shared books and missing-chapter fallback pass');
    await visit(`resolve.html?frontend=${newest.tag}&backend=${oldest.tag}`);
    await page.getByText('Your frontend and backend need different documentation.').waitFor();
    assert((await page.getByRole('link', { name: new RegExp(`Frontend ${newest.tag}`) }).getAttribute('href')).includes(`version=${newest.tag}`));
    await visit('resolve.html?version=edge-abcd');
    await page.locator('.docs-version-development').waitFor();
    const unavailable = [...catalog.releases.filter(release => release.hasBook && !release.snapshot).slice(0, 2),
        catalog.releases.find(release => !release.hasBook)].filter(Boolean);
    for (const { tag } of unavailable) {
        await visit(`versions/${tag}/index.html`);
        await page.waitForURL(url => url.hostname === 'github.com');
        assert.equal(notes.at(-1), `https://github.com/${catalog.repository}/releases/tag/${tag}`);
    }
    await visit('resolve.html?version=https%3A%2F%2Fexample.invalid');
    await page.getByText('The requested version was not recognised. Choose a version below.').waitFor();
    console.log('Independent component versions, edge builds, unavailable books and invalid input pass');
    await visit('dev/index.html');
    await page.locator('.docs-version-development').waitFor();
    if (args.screenshot) await page.screenshot({ path: args.screenshot, fullPage: false });
    // A mobile page load initializes mdBook's sidebar for the small viewport.
    // Resizing an existing desktop page retains its open, sliding sidebar.
    const mobile = await context.newPage();
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(origin + base + 'dev/index.html');
    await mobile.locator('.docs-version-development').waitFor();
    const badge = await mobile.locator('.docs-version-badge').boundingBox();
    assert(badge && badge.x >= 0 && badge.x + badge.width <= 390, 'version label fits a mobile header');
    if (args['mobile-screenshot']) await mobile.screenshot({ path: args['mobile-screenshot'], fullPage: false });
    await mobile.locator('#mdbook-sidebar-toggle').click();
    await mobile.getByLabel('Documentation version').selectOption(oldest.tag);
    await mobile.waitForFunction(tag => document.getElementById('docs-version')?.value === tag, oldest.tag);
    assert(new URL(mobile.url()).pathname.includes(`/books/${oldest.snapshot}/`));
    assert.deepEqual(missing, []);
    assert.deepEqual(errors, []);
    console.log('Project Pages prefix, local assets and mobile version label pass');
} finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
}

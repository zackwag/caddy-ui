import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { prepareBrowserTests, useAuthBrowserFixture } from './fixture.mjs';

before(prepareBrowserTests, { timeout: 35000 });
const options = { timeout: 120000 };
const docsOrigin = 'https://zackwag.github.io';
const resolverPath = '/caddy-ui/resolve.html';

async function fixture(t, frontend) {
    const f = await useAuthBrowserFixture(t, false, { frontendVersion: frontend });
    const { page, context, origin } = f;
    const csrf = await context.request.get(origin + '/api/auth/csrf');
    const setup = await context.request.post(origin + '/api/auth/setup', {
        headers: { 'X-CSRF-Token': (await csrf.json()).csrfToken },
        data: { username: 'documentation-administrator', password: randomBytes(24).toString('base64url') },
    });
    assert.equal(setup.status(), 200);

    // Exercise the real documentation resolver and its policy in a local
    // network fixture, independently of the deployed site's current releases.
    const catalog = { schema: 1, repository: 'zackwag/caddy-ui', development: { path: 'dev/', pages: ['index.html'] },
        books: Object.fromEntries(['3.7.4', '3.7.3'].map(version => [version, { path: `books/${version}/`, pages: ['index.html'] }])),
        releases: ['v3.7.4', 'v3.7.3', 'v1.13'].map(tag => ({ tag, snapshot: tag === 'v1.13' ? null : tag.slice(1),
            images: { frontend: { version: tag.slice(1) }, backend: { version: tag.slice(1) } } })),
    };
    const modules = Object.fromEntries(await Promise.all(['resolve.js', 'versions-model.js'].map(async name =>
        [name, await readFile(new URL('../../docs/theme/' + name, import.meta.url), 'utf8')])));
    const requests = [], unexpected = [];
    t.after(() => assert.deepEqual(unexpected, []));
    await context.route(docsOrigin + '/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname === resolverPath) {
            requests.push(url.href);
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="docs-resolution"></div>'
                + '<script type="module" src="/caddy-ui/_versions/resolve.js" data-docs-version=""></script>' });
        }
        if (url.pathname === '/caddy-ui/documentation.json') return route.fulfill({ json: catalog });
        const module = url.pathname.match(/^\/caddy-ui\/_versions\/(resolve\.js|versions-model\.js)$/)?.[1];
        if (module) return route.fulfill({ contentType: 'text/javascript', body: modules[module] });
        if (url.pathname === '/caddy-ui/dev/index.html') return route.fulfill({ contentType: 'text/html', body: '<h1>Development documentation</h1>' });
        const version = url.pathname.match(/^\/caddy-ui\/books\/(3\.7\.[34])\/index.html$/)?.[1];
        if (version) return route.fulfill({ contentType: 'text/html', body: `<h1>Release v${version}</h1>` });
        if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
        unexpected.push(url.href);
        return route.abort();
    });
    await context.route('https://github.com/zackwag/caddy-ui/releases/tag/v1.13', route =>
        route.fulfill({ contentType: 'text/html', body: '<h1>Release notes v1.13</h1>' }));

    let backend;
    await page.route('**/api/version?*', route => backend === undefined ? route.abort('failed') : route.fulfill({ json: { version: backend, update: null } }));
    const link = page.getByRole('link', { name: 'Documentation', exact: true });
    async function selectBackend(version) {
        backend = version;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.shell').waitFor();
        await page.waitForFunction(({ frontend, backend }) => {
            const href = document.querySelector('.sidebar-documentation')?.href;
            if (!href) return false;
            const query = new URL(href).searchParams;
            return query.get('frontend') === frontend && query.get('backend') === (backend || null);
        }, { frontend, backend });
        const destination = new URL(await link.getAttribute('href'));
        assert.equal(destination.origin + destination.pathname, docsOrigin + resolverPath);
        assert.deepEqual([...destination.searchParams], [['frontend', frontend], ...(backend ? [['backend', backend]] : [])]);
        assert.equal(destination.username + destination.password + destination.hash, '');
        assert.equal(await link.getAttribute('target'), '_blank');
        assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    }
    async function open({ keyboard = false } = {}) {
        const opened = context.waitForEvent('page');
        if (keyboard) await link.press('Enter'); else await link.click();
        const popup = await opened;
        popup.on('pageerror', error => unexpected.push(error.message));
        await popup.waitForLoadState('domcontentloaded');
        return popup;
    }
    return { ...f, link, requests, selectBackend, open };
}

test('sidebar Documentation uses independent versions, opens a new tab and remains usable on mobile and by keyboard', options, async t => {
    const { page, link, requests, selectBackend, open } = await fixture(t, '3.7.4');
    for (const backend of ['3.7.4', '3.7.3', undefined, '', '1.13']) {
        await selectBackend(backend);
        const applicationUrl = page.url();
        if (backend === '3.7.4') {
            const background = await link.evaluate(node => getComputedStyle(node).backgroundColor);
            const accent = await page.evaluate(() => {
                const probe = document.createElement('span');
                probe.style.color = 'var(--accent)';
                document.body.append(probe);
                const color = getComputedStyle(probe).color;
                probe.remove();
                return color;
            });
            await link.hover();
            await page.waitForFunction(color => getComputedStyle(document.querySelector('.sidebar-documentation')).color === color, accent);
            assert.equal(await link.evaluate(node => getComputedStyle(node).backgroundColor), background, 'hover changes text, not the background');
            await page.locator('.nav-footer').screenshot({ path: '/tmp/caddy-ui-documentation-footer.png' });
            await page.getByRole('button', { name: 'Sign out', exact: true }).focus();
            await page.keyboard.press('Tab');
            assert(await link.evaluate(node => node === document.activeElement && node.matches(':focus-visible')));
            assert.equal(await link.evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
        }
        const expected = await link.getAttribute('href');
        const popup = await open({ keyboard: backend === '3.7.4' });
        if (backend === '3.7.3' || backend === '1.13') {
            await popup.getByText('Your frontend and backend need different documentation. Choose the component you are working with.').waitFor();
            const backendLink = popup.getByRole('link', { name: `Backend ${backend} — ${backend === '1.13' ? 'release notes' : 'documentation'}`, exact: true });
            await backendLink.click();
            await popup.getByRole('heading', { name: backend === '1.13' ? 'Release notes v1.13' : 'Release v3.7.3', exact: true }).waitFor();
        } else {
            await popup.getByRole('heading', { name: 'Release v3.7.4', exact: true }).waitFor();
        }
        assert.equal(requests.at(-1), expected, 'the new tab receives only the component version query');
        assert.equal(await popup.evaluate(() => window.opener), null);
        assert.equal(page.url(), applicationUrl, 'opening documentation leaves the app in place');
        await popup.close();
    }

    await selectBackend('3.7.4');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.sidebar.open')?.getBoundingClientRect().x >= 0);
    await link.scrollIntoViewIfNeeded();
    const bounds = await link.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844);
    await page.screenshot({ path: '/tmp/caddy-ui-documentation-mobile.png' });
    const popup = await open();
    await popup.getByRole('heading', { name: 'Release v3.7.4', exact: true }).waitFor();
    await popup.close();
    assert(await page.getByRole('button', { name: 'Security', exact: true }).isVisible());
    assert(await page.getByRole('button', { name: 'Sign out', exact: true }).isVisible());
});

for (const [frontend, backend] of [['dev', 'dev'], ['edge-abc123', 'edge-def456'], ['beta-abc123', 'beta-def456'], ['1.13', '1.13']]) {
    test(`Documentation from ${frontend} uses the published resolver's channel or historical fallback`, options, async t => {
        const { selectBackend, open } = await fixture(t, frontend);
        await selectBackend(backend);
        const popup = await open();
        await popup.getByRole('heading', { name: frontend === '1.13' ? 'Release notes v1.13' : 'Development documentation', exact: true }).waitFor();
        assert.equal(await popup.evaluate(() => window.opener), null);
        await popup.close();
    });
}

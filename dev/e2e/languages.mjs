import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import ar from '../../src/frontend/src/i18n/locales/ar.js';
import en from '../../src/frontend/src/i18n/locales/en.js';
import { prepareBrowserTests, useBrowserFixture } from './fixture.mjs';

before(prepareBrowserTests, { timeout: 35000 });
const options = { timeout: 120000 };
const isArabicFont = url => url.includes('noto-sans-arabic') && url.includes('.woff2');

async function select(page, locale) {
    await page.locator('.language-picker-select').selectOption(locale);
    await page.waitForFunction(locale => document.documentElement.lang === locale
        && document.querySelector('.language-picker-select')?.value === locale, locale);
    await page.evaluate(async () => {
        document.body.getBoundingClientRect();
        await document.fonts.ready;
    });
}

test('reviewed Arabic and its bundled font work without any opt-in', options, async t => {
    const { stack, page, origin, waitForView } = await useBrowserFixture(t, { additionalLanguages: '' });
    assert.deepEqual((await stack.api('/languages')).data, { languages: ['en', 'ar'], fonts: ['ar'] });
    assert.equal((await stack.api('/settings', { method: 'PUT', body: { language: 'ar' } })).status, 200);
    assert.equal((await stack.api('/settings', { method: 'PUT', body: { language: 'de' } })).status, 400);
    const fonts = [];
    page.on('request', request => { if (isArabicFont(request.url())) fonts.push(request.url()); });
    await waitForView('.language-picker-select');
    assert.deepEqual(fonts, []);
    await select(page, 'ar');
    assert.equal(await page.locator('.page-title').innerText(), ar.pages.dashboard);
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    assert.equal(await page.locator('.language-picker-select option[value="de"]').count(), 0);
    assert.equal(fonts.length, 1);
    assert.equal(new URL(fonts[0]).origin, origin);
    assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family.includes('Noto Sans Arabic') && font.status === 'loaded')), true);
    await select(page, 'en');
    assert.equal(await page.locator('.page-title').innerText(), en.pages.dashboard);
    assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
    await select(page, 'ar');
    assert.equal(fonts.length, 1);
});

test('a failed font download preserves translated UI and language switching', options, async t => {
    const { page, waitForView } = await useBrowserFixture(t, { additionalLanguages: '' });
    await page.route('**/*noto-sans-arabic*.woff2*', route => route.abort('failed'));
    await waitForView('.language-picker-select');
    await select(page, 'ar');
    assert.equal(await page.locator('.page-title').innerText(), ar.pages.dashboard);
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family.includes('Noto Sans Arabic') && font.status === 'error')), true);
    await select(page, 'en');
    assert.equal(await page.locator('.page-title').innerText(), en.pages.dashboard);
});

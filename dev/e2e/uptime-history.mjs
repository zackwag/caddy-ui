import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { prepareBrowserTests, useBrowserFixture } from './fixture.mjs';

before(prepareBrowserTests, { timeout: 35000 });
const day = 24 * 60 * 60 * 1000;

async function scenario(t, age) {
    const f = await useBrowserFixture(t);
    const { page, stack, origin } = f;
    const domain = 'history.example.test';
    const created = await stack.api('/routes', { method: 'POST', body: { domain, upstream: '127.0.0.1:9' } });
    assert.equal(created.status, 201);
    const epoch = Date.now();
    await page.clock.install({ time: new Date(epoch) });
    await page.clock.pauseAt(new Date(epoch + 1000));
    const now = await page.evaluate(() => Date.now());
    const start = now - age;
    const recorded = [{ at: start - 30_000, online: true }, { at: start, online: false }, { at: start + 27_000, online: true }];
    const reads = [];
    await page.route('**/api/health/history?*', async route => {
        const since = Number(new URL(route.request().url()).searchParams.get('since'));
        const observedAt = await page.evaluate(() => Date.now());
        // Each read supplies another successful check, so the rendered count
        // confirms React has consumed this response before assertions proceed.
        const entries = [...recorded, ...Array.from({ length: reads.length + 1 }, (_, index) => ({ at: observedAt - (index + 1) * 1000, online: true }))]
            .filter(entry => entry.at >= since).sort((a, b) => a.at - b.at);
        reads.push({ since, checks: entries.length });
        await route.fulfill({ json: { entries, intervalMs: 30_000 } });
    });
    const dialog = page.getByRole('dialog', { name: domain, exact: true });
    async function load(action) {
        const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/health/history');
        await action();
        await (await pending).finished();
        await dialog.locator('.history-coverage').filter({ hasText: `${reads.at(-1).checks} checks` }).waitFor();
    }
    await page.goto(origin + '/routes', { waitUntil: 'domcontentloaded' });
    await load(() => page.locator('tbody tr').filter({ hasText: domain }).locator('.col-status--clickable').click());
    return { ...f, dialog, reads, load };
}

test('uptime history keeps its loaded window stable across unrelated renders and names its timeline', { timeout: 120000 }, async t => {
    const { page, dialog, reads, load } = await scenario(t, 10 * 60_000);
    await load(() => dialog.getByRole('checkbox', { name: 'Auto-refresh', exact: true }).uncheck());
    const titles = await dialog.locator('.history-segment').evaluateAll(nodes => nodes.map(node => node.title));
    const checks = reads.length;
    await page.clock.fastForward(10_000);
    await page.evaluate(async () => {
        const { default: i18n } = await import('/src/i18n/index.js');
        await i18n.changeLanguage('en-US');
    });
    await page.waitForFunction(() => document.documentElement.lang.toLowerCase() === 'en-us');
    assert.equal(reads.length, checks, 'Changing locale must not refetch history');
    assert.deepEqual(await dialog.locator('.history-segment').evaluateAll(nodes => nodes.map(node => node.title)), titles,
        'An unrelated render must not move the loaded timeline boundaries');
    await dialog.getByRole('img', { name: 'Observed online, offline and unmonitored intervals', exact: true }).waitFor();
    assert.equal(await dialog.locator('.history-outage-marker').count(), 1);
    await dialog.screenshot({ path: '/tmp/caddy-ui-uptime-history-desktop.png' });
});

test('uptime refresh leaves inspection when its outage exits the seven-day window', { timeout: 120000 }, async t => {
    const { page, dialog, load } = await scenario(t, 7 * day - 60_000);
    await load(() => dialog.getByRole('button', { name: '7d', exact: true }).click());
    const marker = dialog.locator('.history-outage-marker');
    await marker.press('Enter');
    await dialog.getByRole('button', { name: 'Back to overview', exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.screenshot({ path: '/tmp/caddy-ui-uptime-history-mobile.png' });
    // The outage ends 87 seconds inside the original window. At 90 seconds
    // it is outside, although most of its five-minute context remains inside.
    await load(() => page.clock.fastForward(90_000));
    assert.equal(await dialog.getByRole('button', { name: 'Back to overview', exact: true }).count(), 0);
    assert((await dialog.getByRole('button', { name: '7d', exact: true }).getAttribute('class')).includes('btn-primary'));
    await dialog.getByText('No outages recorded in this interval.', { exact: true }).waitFor();
    await dialog.locator('.history-axis-tick').filter({ hasText: 'Now' }).waitFor();
});

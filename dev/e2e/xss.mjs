import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { prepareBrowserTests, useBrowserFixture } from './fixture.mjs';

const image = '<img data-xss-probe src=/__xss_probe onerror="window.xssHits++">';
const svg = '<svg data-xss-probe onload="window.xssHits++"></svg>';
const payloads = [image, svg, '</textarea>' + image, '">' + svg];
const options = { timeout: 120000 };

before(prepareBrowserTests, { timeout: 35000 });

async function watchForXss(page) {
    await page.addInitScript(() => { window.xssHits = 0; });
    await page.evaluate(() => { window.xssHits = 0; });
    const requests = [];
    page.on('request', request => {
        if (new URL(request.url()).pathname === '/__xss_probe') requests.push(request.url());
    });
    // Prove handlers can execute, so CSP or browser settings cannot mask a
    // rendering regression in the checks below.
    const control = await page.evaluate(() => new Promise(resolve => {
        const node = document.createElement('img');
        node.setAttribute('onerror', 'window.xssHits++');
        node.addEventListener('error', () => { node.remove(); resolve(window.xssHits); }, { once: true });
        node.src = 'data:image/png;base64,invalid';
        document.body.append(node);
    }));
    assert.equal(control, 1, 'The XSS positive control must execute without CSP');
    await page.evaluate(() => { window.xssHits = 0; });
    return async () => {
        assert.equal(await page.locator('[data-xss-probe]').count(), 0, 'Payloads must never become DOM elements');
        assert.equal(await page.evaluate(() => window.xssHits), 0, 'No injected handler may execute');
        assert.deepEqual(requests, [], 'Rendering content must not load injected resources');
    };
}

async function expectText(locator, text) {
    await locator.filter({ hasText: text }).first().waitFor();
    assert((await locator.allTextContents()).some(value => value.includes(text)));
}

test('Caddy log snapshots and live streams render hostile content as text', options, async t => {
    const { stack, page, origin } = await useBrowserFixture(t);
    const safe = await watchForXss(page);
    const { instance } = stack.instances.get('alpha');
    const append = text => stack.harness.run(['exec', instance.containerName, 'sh', '-c',
        'printf "%s\\n" "$1" >> "$2"', 'xss-test', text, instance.logPath]);
    await append(payloads.join('\n'));
    await page.goto(origin + '/logs?dist=caddy', { waitUntil: 'domcontentloaded' });
    for (const payload of payloads) await expectText(page.locator('.log-line'), payload);
    await safe();

    await page.getByRole('button', { name: 'Live', exact: true }).click();
    // Establish delivery after tail starts, rather than guessing its startup time.
    let ready = false;
    const delivered = page.getByText('xss-stream-ready', { exact: true }).first().waitFor().then(() => { ready = true; });
    await Promise.all([delivered, (async () => {
        for (let attempt = 0; attempt < 30 && !ready; attempt++) {
            await append('xss-stream-ready');
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    })()]);
    for (const payload of payloads) {
        const line = 'live: ' + payload;
        await append(line);
        await expectText(page.locator('.log-line'), line);
    }
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await safe();

    // Application diagnostics are structured JSON, then rendered by the same
    // viewer. Control just this response to exercise nested hostile fields too.
    await page.route('**/api/logs/app', route => route.fulfill({ json: {
        entries: payloads.map(message => ({ level: 'warn', message, context: { detail: message } })),
    } }));
    await page.getByRole('button', { name: 'caddy/ui', exact: true }).click();
    for (const payload of payloads) await expectText(page.locator('.log-line'), JSON.stringify(payload).slice(1, -1));
    await safe();
});

test('persisted route, server, instance and API-token names stay text after reload', options, async t => {
    const { stack, page, origin } = await useBrowserFixture(t);
    const safe = await watchForXss(page);
    assert.equal((await stack.api('/instances/default', { method: 'PUT', body: { name: image } })).status, 200);
    assert.equal((await stack.api('/server-names/srv0', { method: 'PUT', body: { name: svg } })).status, 200);
    const domain = 'xss.example.test';
    assert.equal((await stack.api('/routes', { method: 'POST', body: { domain, upstream: '127.0.0.1:1' } })).status, 201);
    assert.equal((await stack.api('/route-notes/' + domain, { method: 'PUT', body: { note: image } })).status, 200);
    const token = await stack.api('/auth/tokens', { method: 'POST', body: {
        name: svg, scopes: ['status:read'], instanceIds: ['default'], expiresInDays: 30,
    } });
    assert.equal(token.status, 201);

    await page.goto(origin + '/instances', { waitUntil: 'domcontentloaded' });
    await expectText(page.locator('.main'), image);
    await expectText(page.locator('.main'), svg);
    await safe();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectText(page.locator('.main'), image);
    await safe();

    await page.goto(origin + '/routes', { waitUntil: 'domcontentloaded' });
    await expectText(page.locator('tbody tr').filter({ hasText: domain }), image);
    await safe();
    await page.getByRole('button', { name: 'Security', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Security', exact: true });
    await dialog.getByRole('button', { name: 'API tokens', exact: true }).click();
    await expectText(dialog.locator('.api-token-list strong'), svg);
    await expectText(dialog.locator('.auth-ack'), image);
    assert.equal(await dialog.getByRole('button', { name: 'Revoke ' + svg, exact: true }).count(), 1);
    await safe();
});

test('Caddyfile editor, history diffs, raw previews and actor names never interpret HTML', options, async t => {
    const { stack, page, origin } = await useBrowserFixture(t);
    const safe = await watchForXss(page);
    const initial = (await stack.api('/caddyfile')).data;
    const content = payloads.map(payload => '# ' + payload).join('\n') + '\n' + initial;
    assert.equal((await stack.api('/caddyfile?fmt=false&sort=false', { method: 'PUT', plain: true, body: content })).status, 200);
    await page.goto(origin + '/caddyfile', { waitUntil: 'domcontentloaded' });
    await page.locator('.cm-editor').waitFor();
    for (const payload of payloads) await expectText(page.locator('.cm-content'), payload);
    await safe();
    await page.getByRole('button', { name: /^History/ }).click();
    for (const payload of payloads) await expectText(page.locator('.diff-text'), payload);
    await safe();
    await page.getByRole('button', { name: 'Raw', exact: true }).click();
    for (const payload of payloads) await expectText(page.locator('.history-preview'), payload);
    await safe();

    // Usernames are deliberately constrained at enrollment. History can also
    // contain imported/older actor metadata: exercise that renderer without
    // weakening the credential validator just to construct the fixture.
    const entries = (await stack.api('/caddyfile/history')).data;
    await page.route('**/api/caddyfile/history', route => route.fulfill({ json: entries.map(entry => ({
        ...entry, actor: { id: 'xss-actor', type: 'user', name: svg },
    })) }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^History/ }).click();
    await expectText(page.locator('.history-attribution'), svg);
    await page.getByRole('button', { name: 'Show version list', exact: true }).click();
    await expectText(page.locator('.history-entry-actor'), svg);
    await safe();
});

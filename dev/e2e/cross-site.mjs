import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';
import { createCrossSiteFixture } from '../../src/backend/test/fixtures/crossSite.mjs';
import { FixtureScope } from '../integration/lifecycle.mjs';

async function fixture(t, configured = true) {
    const scope = new FixtureScope(t.signal);
    t.after(() => scope.close());
    const target = await scope.acquire(() => createCrossSiteFixture(configured), value => value.close());
    const attacker = await scope.acquire(async () => {
        const server = createServer((req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><title>Foreign origin fixture</title>');
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        return server;
    }, async server => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    const browser = await scope.acquire(() => chromium.launch({
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    }), value => value.close());
    const context = await scope.acquire(() => browser.newContext(), value => value.close());
    const page = await scope.run(() => context.newPage());
    page.setDefaultTimeout(10000);
    return { target, page, attackerOrigin: `http://localhost:${attacker.address().port}` };
}

for (const configured of [true, false]) {
    test(`HTTP writes without Fetch Metadata validate origin (configured=${configured})`, { timeout: 30000 }, async t => {
        const { target, page, attackerOrigin } = await fixture(t, configured);
        await page.goto(attackerOrigin);
        // no-cors is intentional: response readability never prevents a simple
        // POST from reaching its handler. Assert the server-side effect too.
        const result = await page.evaluate(async url => {
            const response = await fetch(url, { method: 'POST', mode: 'no-cors', body: 'forged' });
            return response.type;
        }, target.origin + '/api/write');
        assert.equal(result, 'opaque');
        assert.deepEqual(target.records.at(-1), { method: 'POST', origin: attackerOrigin, site: undefined, status: 403 });
        assert.equal(target.writes, 0);

        const response = page.waitForResponse(value => value.url() === target.origin + '/api/write' && value.request().method() === 'POST');
        await page.evaluate(url => {
            const frame = document.createElement('iframe');
            frame.name = 'forged-form';
            document.body.append(frame);
            const form = document.createElement('form');
            form.target = frame.name;
            form.method = 'POST';
            form.action = url;
            document.body.append(form);
            form.submit();
        }, target.origin + '/api/write');
        assert.equal((await response).status(), 403);
        assert.equal(target.records.at(-1).site, undefined);
        assert.equal(target.writes, 0);

        await page.goto(target.origin);
        assert.equal(await page.evaluate(() => isSecureContext), false);
        const ownStatus = await page.evaluate(async () => (await fetch('/api/write', { method: 'POST' })).status);
        assert.equal(ownStatus, configured ? 200 : 403);
        assert.equal(target.records.at(-1).origin, target.origin);
        assert.equal(target.records.at(-1).site, undefined);
        assert.equal(target.writes, configured ? 1 : 0);
    });
}

test('trustworthy destinations still reject cross-site Fetch Metadata and cross-origin reads', { timeout: 30000 }, async t => {
    const { target, page, attackerOrigin } = await fixture(t, false);
    await page.goto(attackerOrigin);
    await page.evaluate(async url => {
        await fetch(url, { method: 'POST', mode: 'no-cors', body: 'forged' });
    }, target.directOrigin + '/api/write');
    assert.equal(target.records.at(-1).site, 'cross-site');
    assert.equal(target.records.at(-1).status, 403);
    assert.equal(target.writes, 0);
    const readable = await page.evaluate(async url => {
        try { await fetch(url); return true; }
        catch { return false; }
    }, target.directOrigin + '/api/read');
    assert.equal(readable, false);

    await page.goto(target.directOrigin);
    const status = await page.evaluate(async () => (await fetch('/api/write', { method: 'POST' })).status);
    assert.equal(status, 200);
    assert.equal(target.records.at(-1).site, 'same-origin');
    assert.equal(target.writes, 1);
});

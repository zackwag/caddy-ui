import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { FixtureScope } from '../../test/integration/lifecycle.mjs';
import { createTestStack } from '../../test/integration/stack.mjs';

const frontend = resolve(import.meta.dirname, '..');

export function prepareBrowserTests() {
    return promisify(execFile)(process.execPath, ['scripts/fetch-caddyfile-mode.mjs'], { cwd: frontend, timeout: 30000 });
}

// One scenario owns the whole stack. No page, registry, locale or viewport state
// survives into the next scenario, including after failure or cancellation.
export async function useBrowserFixture(t) {
    const scope = new FixtureScope(t.signal);
    const pageErrors = [];
    const requests = [];
    t.after(async () => {
        await scope.close();
        assert.deepEqual(pageErrors, [], 'Uncaught browser JavaScript errors');
    });

    const stack = await createTestStack(scope);
    const vite = await scope.acquire(() => createServer({
        root: frontend,
        cacheDir: resolve(stack.directory, 'vite-cache'),
        server: { host: '127.0.0.1', port: 0, proxy: { '/api': stack.url } },
    }), vite => vite.close());
    await scope.run(() => vite.listen());
    const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
    const browser = await scope.acquire(() => chromium.launch({
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    }), browser => browser.close());
    const context = await scope.acquire(() => browser.newContext({ viewport: { width: 1440, height: 900 } }), context => context.close());
    const page = await scope.run(() => context.newPage());
    page.setDefaultTimeout(10000);
    const record = entry => {
        requests.push(entry);
        if (requests.length > 80) requests.shift();
    };
    let networkChanged;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => record({ url: request.url() }));
    page.on('response', response => record({ url: response.url(), status: response.status() }));
    page.on('requestfailed', request => {
        if (request.failure()?.errorText === 'net::ERR_NETWORK_CHANGED') networkChanged = true;
        record({ url: request.url(), failure: request.failure() });
    });
    page.on('console', message => { if (message.type() === 'error') record({ error: message.text() }); });

    async function waitForView(selector) {
        try { await page.locator(selector).waitFor(); }
        catch (error) {
            const body = await page.locator('body').innerText().catch(() => '<page unavailable>');
            const logs = await stack.api('/logs/app').catch(() => ({ data: null }));
            throw new Error(`${selector} did not become ready at ${page.url()}\n${body}\n${JSON.stringify(requests.slice(-40))}\n${JSON.stringify(logs.data?.entries?.slice(-30))}`, { cause: error });
        }
    }

    // Docker interface creation can invalidate Chromium's network state. Retry
    // only initial navigation for that transport error; assertions run once.
    for (let attempt = 0; attempt < 3; attempt++) {
        networkChanged = false;
        try {
            await scope.run(() => page.goto(origin + '/dashboard'));
            await waitForView('.shell');
            break;
        } catch (error) {
            if (!networkChanged || attempt === 2) throw error;
        }
    }
    return { stack, page, context, origin, waitForView };
}

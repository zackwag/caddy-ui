import { test } from 'node:test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { FixtureScope } from '../integration/lifecycle.mjs';
import { createDiagnostics } from './observe.mjs';

const { chromium } = createRequire(new URL('../../frontend/package.json', import.meta.url))('playwright');

test('localhost module-loading control', { timeout: 30000 }, async t => {
    const scope = new FixtureScope(t.signal);
    let diagnostics;
    t.after(async () => { try { await diagnostics?.captureFinal(); } finally { await scope.close(); } });
    diagnostics = await createDiagnostics(t, scope, { staticControl: true });
    const server = await scope.acquire(() => createServer((request, response) => {
        if (request.url.startsWith('/module-')) {
            const timer = setTimeout(() => {
                response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end('export const value = 1;');
            }, 200);
            response.on('close', () => clearTimeout(timer));
        } else {
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.end('<!doctype html><script type="module">await Promise.all(Array.from({length:40},(_,i)=>import("/module-"+i+".js")));document.body.innerHTML="<p class=ready>Ready</p>";</script><body></body>');
        }
    }), server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    await scope.run(() => new Promise(resolve => server.listen(0, '127.0.0.1', resolve)));
    const browser = await scope.acquire(() => chromium.launch({ ...diagnostics.launchOptions,
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    }), browser => browser.close());
    const context = await scope.acquire(() => browser.newContext(), context => context.close());
    const page = await scope.run(() => context.newPage());
    await diagnostics.attach(page, context);
    await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'domcontentloaded' });
    await page.locator('.ready').waitFor({ timeout: 2500 });
});

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { FixtureScope } from '../integration/lifecycle.mjs';
import { waitForContainerNetwork, waitForHttp } from '../integration/stack.mjs';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');

// Exercise the shipped nginx config and built assets, not a policy injected into
// Vite by the test. API responses are controlled here; auth policy has its own
// real-backend browser suite. No external font service is needed for this test.
test('production CSP blocks script injection and keeps HTTP and HTTPS UI features working', { timeout: 180000 }, async t => {
    const scope = new FixtureScope(t.signal);
    t.after(() => scope.close());
    const directory = await scope.acquire(() => mkdtemp(join(tmpdir(), 'caddy-ui-csp-')),
        value => rm(value, { recursive: true, force: true }));
    const dist = join(directory, 'dist');
    await exec('npm', ['run', 'build', '--prefix', 'src/frontend', '--', '--outDir', dist],
        { cwd: root, timeout: 60000, signal: scope.signal });
    await writeFile(join(dist, 'csp-probe.js'), `
        window.cspProbe = { self: true };
        try { window.cspProbe.eval = eval('true'); } catch { window.cspProbe.eval = false; }
        try { window.cspProbe.function = new Function('return true')(); } catch { window.cspProbe.function = false; }
    `);
    await writeFile(join(dist, 'csp-probe.html'), `<!doctype html>
        <script src="/csp-probe.js"></script>
        <script>window.inlineScriptRan = true</script>
        <script src="https://attacker.invalid/injected.js"></script>
        <button onclick="window.inlineHandlerRan = true">Inline handler</button>
        <base href="https://attacker.invalid/">
        <iframe src="/index.html"></iframe>`);
    // Match the image's public asset permissions even under a restrictive umask.
    async function makeReadable(path) {
        await chmod(path, 0o755);
        for (const entry of await readdir(path, { withFileTypes: true })) {
            const child = join(path, entry.name);
            if (entry.isDirectory()) await makeReadable(child);
            else await chmod(child, 0o644);
        }
    }
    await makeReadable(dist);
    const container = 'caddy-ui-csp-' + randomUUID();
    await scope.acquire(() => exec('docker', ['create', '--name', container,
        '--label', 'io.caddy-ui.test-fixture=true', '--add-host', 'caddy-ui-backend:127.0.0.1',
        '-p', '127.0.0.1::80',
        '-v', `${dist}:/usr/share/nginx/html:ro`,
        '-v', `${join(root, 'src/frontend/nginx.conf')}:/etc/nginx/conf.d/default.conf:ro`,
        'nginx:alpine'], { timeout: 60000, signal: scope.signal }),
    () => exec('docker', ['rm', '-f', container], { timeout: 10000 }));
    await exec('docker', ['start', container], { timeout: 15000, signal: scope.signal });
    await waitForContainerNetwork(container, { signal: scope.signal });
    const { stdout } = await exec('docker', ['port', container, '80/tcp'], { timeout: 10000 });
    const port = Number(stdout.trim().split(':').at(-1));
    assert(Number.isInteger(port) && port > 0);
    const upstream = `http://127.0.0.1:${port}`;
    await waitForHttp(upstream, { signal: scope.signal });

    // Terminate TLS in front of the same nginx, as a normal reverse proxy does.
    const key = join(directory, 'key.pem');
    const cert = join(directory, 'cert.pem');
    await exec('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
        '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost',
        '-addext', 'subjectAltName=DNS:localhost'], { timeout: 10000 });
    const tls = { key: await readFile(key), cert: await readFile(cert) };
    const pin = createHash('sha256').update(new X509Certificate(tls.cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    const proxy = await scope.acquire(async () => {
        const server = createServer(tls, (req, res) => {
            const remote = request(upstream + req.url, { method: req.method, headers: req.headers }, response => {
                res.writeHead(response.statusCode, response.headers);
                response.pipe(res);
            });
            remote.on('error', () => { res.writeHead(502); res.end(); });
            res.on('close', () => remote.destroy());
            req.pipe(remote);
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        return server;
    }, async server => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const browser = await scope.acquire(() => chromium.launch({
        args: ['--ignore-certificate-errors-spki-list=' + pin],
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    }), value => value.close());
    const font = await readFile(join(root, 'src/frontend/node_modules/@fontsource-variable/noto-sans-arabic/files/noto-sans-arabic-latin-standard-normal.woff2'));

    for (const origin of [`http://[::ffff:127.0.0.1]:${port}`, `https://localhost:${proxy.address().port}`]) {
        await t.test(new URL(origin).protocol, async () => {
            const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(10000);
                const errors = [];
                const unexpected = [];
                let authenticated = false;
                await page.addInitScript(() => {
                    window.cspViolations = [];
                    addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.effectiveDirective));
                });
                page.on('pageerror', error => errors.push(error.message));
                await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css',
                    body: '@font-face { font-family: "IBM Plex Sans"; src: url(https://fonts.gstatic.com/csp-fixture.woff2) format("woff2"); }' }));
                await page.route('https://fonts.gstatic.com/csp-fixture.woff2', route => {
                    return route.fulfill({ contentType: 'font/woff2', headers: { 'Access-Control-Allow-Origin': '*' }, body: font });
                });
                await page.route('**/api/**', route => {
                    const path = new URL(route.request().url()).pathname.slice(4);
                    const json = data => route.fulfill({ json: data });
                    switch (path) {
                        case '/languages': return json({ languages: ['en'], fonts: [] });
                        case '/auth/status': return json({ authEnabled: true, authenticated, username: 'csp-admin', passkeys: [] });
                        case '/auth/credentials': return json({ username: 'csp-admin' });
                        case '/auth/csrf': return json({ csrfToken: 'csp-fixture' });
                        case '/auth/sessions': authenticated = true; return json({ ok: true });
                        case '/settings': return json({ firstTimeRun: false, language: 'en', theme: 'dark' });
                        case '/custom-themes': return json([]);
                        case '/version': return json({ version: 'dev', update: {} });
                        case '/instances': return json([{ id: 'default', name: 'CSP fixture' }]);
                        case '/instances/status': return json({ default: { online: true } });
                        case '/status': return json({ online: true, servers: [] });
                        case '/caddyfile': return route.fulfill({ contentType: 'text/plain', body: ':80 {\n respond "CSP editor"\n}\n' });
                        case '/caddyfile/history': return json([]);
                        case '/logs/config': return json({ enabled: true, path: '/var/log/caddy/access.log', rollSize: '50mb', rollKeep: 5, format: 'json', level: 'INFO' });
                        case '/logs': return json({ lines: ['CSP snapshot'] });
                        case '/logs/stream': return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"line":"CSP live delivery"}\n\n' });
                        case '/auth/tokens': return json({ tokens: [] });
                        case '/auth/totp/setup': return json({ secret: 'test-only',
                            uri: 'otpauth://totp/CSP?secret=' + 'A'.repeat(32), expiresAt: new Date(Date.now() + 60000).toISOString() });
                        default: unexpected.push(path); return json({});
                    }
                });
                const response = await page.goto(origin + '/caddyfile', { waitUntil: 'domcontentloaded' });
                const policy = response.headers()['content-security-policy'];
                assert(policy, 'nginx must send an enforced CSP on deep links');
                assert(!/upgrade-insecure-requests|block-all-mixed-content/.test(policy), 'HTTP must remain supported');
                assert.equal(new URL(page.url()).protocol, new URL(origin).protocol);
                assert.equal(await page.evaluate(() => window.isSecureContext), new URL(origin).protocol === 'https:',
                    'Plain HTTP must be tested outside the secure localhost exception');
                await page.getByLabel('Username', { exact: true }).fill('csp-admin');
                await page.getByLabel('Password', { exact: true }).fill(randomUUID());
                await page.getByRole('button', { name: 'Sign in', exact: true }).click();
                await page.locator('.cm-editor').waitFor();
                // Exercise the application's font whether it is supplied by the
                // current Google import or by a subsequent local font bundle.
                assert.equal(await page.evaluate(async () => {
                    await document.fonts.ready;
                    const faces = await document.fonts.load('400 12px "IBM Plex Sans"');
                    return faces.length > 0 && faces.every(face => face.status === 'loaded');
                }), true);
                await page.locator('.cm-content').click();
                await page.keyboard.insertText('# edited under CSP\n');
                assert((await page.locator('.cm-content').innerText()).includes('edited under CSP'));
                assert.notEqual(await page.locator('.shell').evaluate(element => getComputedStyle(element).display), 'block', 'App styles must load');

                await page.getByRole('button', { name: 'Security', exact: true }).click();
                const dialog = page.getByRole('dialog', { name: 'Security', exact: true });
                await dialog.getByRole('button', { name: 'Auth', exact: true }).click();
                await dialog.getByRole('button', { name: 'Authenticator app (TOTP)', exact: true }).click();
                await dialog.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
                await dialog.locator('#security-totp').getByLabel('Current password', { exact: true }).fill(randomUUID());
                await dialog.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
                await page.waitForFunction(() => document.querySelector('.totp-qr')?.naturalWidth > 0);
                await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
                await dialog.getByRole('button', { name: 'Close', exact: true }).click();

                await page.goto(origin + '/logs?dist=caddy', { waitUntil: 'domcontentloaded' });
                await page.getByText('CSP snapshot', { exact: true }).waitFor();
                const download = page.waitForEvent('download');
                await page.getByRole('button', { name: 'Export', exact: true }).click();
                assert.match((await download).suggestedFilename(), /\.log$/);
                await page.getByRole('button', { name: 'Live', exact: true }).click();
                await page.getByText('CSP live delivery', { exact: true }).waitFor();
                await page.getByRole('button', { name: 'Stop', exact: true }).click();
                assert.deepEqual(await page.evaluate(() => window.cspViolations), [], 'Supported UI features must not violate CSP');
                assert.deepEqual(errors, []);
                assert.deepEqual(unexpected, []);

                // Use normal script loading: Playwright evaluate itself bypasses
                // CSP and cannot establish that eval is blocked in application JS.
                let externalScriptRequested = false;
                await page.route('https://attacker.invalid/**', route => { externalScriptRequested = true; return route.abort(); });
                await page.goto(origin + '/csp-probe.html', { waitUntil: 'load' });
                await page.getByRole('button', { name: 'Inline handler' }).click();
                assert.deepEqual(await page.evaluate(() => window.cspProbe), { self: true, eval: false, function: false });
                assert.equal(await page.evaluate(() => !!window.inlineScriptRan || !!window.inlineHandlerRan), false);
                assert.equal(externalScriptRequested, false, 'External scripts must be blocked before a request');
                assert.equal(await page.evaluate(() => document.baseURI), new URL('/csp-probe.html', origin).href);
                await page.waitForFunction(() => new Set(window.cspViolations).size >= 5);
                const violations = await page.evaluate(() => window.cspViolations);
                for (const directive of ['script-src-elem', 'script-src-attr', 'script-src', 'base-uri', 'frame-src']) {
                    assert(violations.includes(directive), `Missing enforced ${directive} check: ${violations}`);
                }
            } finally { await context.close(); }
        });
    }
});

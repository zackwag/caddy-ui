import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(resolve(import.meta.dirname, '../../dev/package.json'));
const { chromium } = require('playwright');
import { createReplayFetch } from '../../dev/playground/capture-format.js';
import { screenshotRecords } from './replay.mjs';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const screenshotsDir = resolve(root, 'docs/src/screenshots');

const VIEWS = [
    { name: 'dashboard', path: '/dashboard', ready: '.grid-4' },
    { name: 'caddyfile', path: '/caddyfile', ready: '.caddyfile-editor' },
    { name: 'routes', path: '/routes', ready: '.routes-toolbar' },
    { name: 'tls', path: '/tls', ready: '.grid-4' },
    { name: 'logs', path: '/logs', ready: '.log-wrap' },
    { name: 'metrics', path: '/metrics', ready: '.grid-3' },
    { name: 'notifications', path: '/notifications', ready: '.notifications-enabled-btn' },
    { name: 'instances', path: '/instances', ready: '.instance-details-grid' },
];

// Build as the captured backend's version so the sidebar shows one release,
// not "dev (backend vX)". A separate output leaves src/frontend/dist alone.
async function buildFrontend(version, outDir) {
    console.log(`Building frontend v${version}...`);
    await exec('npm', ['run', 'build', '--', '--outDir', outDir, '--emptyOutDir'], {
        cwd: resolve(root, 'src/frontend'), timeout: 120_000, env: { ...process.env, VITE_APP_VERSION: version },
    });
}

function serveStatic(directory) {
    const mimeTypes = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
        '.woff': 'font/woff', '.woff2': 'font/woff2',
    };
    const server = createServer(async (req, res) => {
        let filePath = resolve(directory, req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0]);
        if (!filePath.startsWith(directory)) { res.writeHead(403); res.end(); return; }
        try {
            const data = await readFile(filePath);
            const ext = filePath.match(/\.[^.]+$/)?.[0] || '';
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
            res.end(data);
        } catch {
            // SPA fallback: serve index.html for unmatched paths.
            try {
                const data = await readFile(resolve(directory, 'index.html'));
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            } catch {
                res.writeHead(404);
                res.end();
            }
        }
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

export async function renderScreenshots({ capturePath = resolve(import.meta.dirname, 'captures/screenshots.json'), outputDirectory = screenshotsDir } = {}) {
    const capture = JSON.parse(await readFile(capturePath, 'utf8'));
    const records = screenshotRecords(capture);
    const version = records.find(record => record.request.method === 'GET' && record.request.path === '/version').response.body.version;
    const dist = await mkdtemp(resolve(tmpdir(), 'caddy-ui-screenshots-frontend-'));
    try {
        await buildFrontend(version, dist);
    } catch (error) {
        await rm(dist, { recursive: true, force: true });
        throw error;
    }
    await mkdir(outputDirectory, { recursive: true });

    const server = await serveStatic(dist);
    const { port } = server.address();
    const origin = `http://127.0.0.1:${port}`;
    console.log(`Serving frontend at ${origin}`);

    let browser;
    try {
        browser = await chromium.launch({
            ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
        });
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 1,
            locale: 'en-US',
            timezoneId: 'UTC',
        });

        const page = await context.newPage();
        const errors = [];
        const replay = createReplayFetch(records, undefined, origin);
        page.on('pageerror', error => errors.push(error.message));

        // Freeze clock for deterministic timestamps.
        await page.clock.install({ time: new Date('2025-06-15T14:30:00Z') });

        // Intercept all API requests and replay from captured data.
        await page.route('**/api/**', async route => {
            const request = route.request();
            try {
                const response = await replay(request.url(), {
                    method: request.method(), headers: request.headers(),
                    ...(!['GET', 'HEAD'].includes(request.method()) ? { body: request.postDataBuffer() } : {}),
                });
                await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
            } catch (error) {
                errors.push(error.message);
                await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: error.message }) });
            }
        });

        for (const view of VIEWS) {
            console.log(`Capturing ${view.name}...`);
            await page.goto(`${origin}${view.path}`, { waitUntil: 'networkidle' });

            await page.waitForSelector('.shell', { timeout: 10000 });
            await page.waitForSelector(view.ready, { timeout: 10000 });

            // Extra settle time for animations and lazy rendering.
            await page.waitForTimeout(500);
            if (errors.length) {
                throw new Error(`Screenshot ${view.name} failed: ${errors.join('\n')}`);
            }

            await page.screenshot({
                path: resolve(outputDirectory, `${view.name}.png`),
                fullPage: false,
            });
            console.log(`  Saved ${view.name}.png`);
        }
    } finally {
        await browser?.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await rm(dist, { recursive: true, force: true });
    }

    console.log(`Generated ${VIEWS.length} screenshots in ${outputDirectory}.`);
    return VIEWS.map(view => view.name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    renderScreenshots().catch(error => { console.error(error); process.exitCode = 1; });
}

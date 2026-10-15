import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(resolve(import.meta.dirname, '../../frontend/package.json'));
const { chromium } = require('playwright');
import { requestKey, validateCapture } from '../../frontend/playground/capture-format.js';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const dist = resolve(root, 'frontend/dist');
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

async function buildFrontend() {
    try {
        await readFile(resolve(dist, 'index.html'));
        console.log('Using existing frontend build.');
    } catch {
        console.log('Building frontend...');
        await exec('npm', ['run', 'build'], { cwd: resolve(root, 'frontend'), timeout: 120_000 });
    }
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

function buildResponseMap(capture) {
    const responses = new Map();
    for (const scenario of capture.scenarios) {
        for (const record of scenario.requests) {
            const key = requestKey(record.request);
            if (!responses.has(key)) responses.set(key, record);
        }
    }
    return responses;
}

async function run() {
    await buildFrontend();

    const capture = validateCapture(JSON.parse(await readFile(resolve(import.meta.dirname, 'captures/screenshots.json'), 'utf8')));
    const responses = buildResponseMap(capture);

    const server = await serveStatic(dist);
    const { port } = server.address();
    const origin = `http://127.0.0.1:${port}`;
    console.log(`Serving frontend at ${origin}`);

    const browser = await chromium.launch({
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    });

    try {
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 1,
            locale: 'en-US',
            timezoneId: 'UTC',
        });

        const page = await context.newPage();

        // Freeze clock for deterministic timestamps.
        await page.clock.install({ time: new Date('2025-06-15T14:30:00Z') });

        // Intercept all API requests and replay from captured data.
        await page.route('**/api/**', async route => {
            const request = route.request();
            const url = new URL(request.url());
            const path = url.pathname.replace(/^\/api(?=\/|$)/, '') + url.search;
            let body = null;
            if (!['GET', 'HEAD'].includes(request.method())) {
                const postData = request.postData();
                if (postData) {
                    const contentType = request.headers()['content-type'] || '';
                    body = contentType.includes('application/json') ? JSON.parse(postData) : postData;
                }
            }
            const key = requestKey({ method: request.method(), path, body });
            const record = responses.get(key);
            if (!record) {
                console.warn(`  Unrecorded: ${request.method()} ${url.pathname}${url.search}`);
                await route.fulfill({ status: 500, contentType: 'application/json',
                    body: JSON.stringify({ error: 'Unrecorded request', path: url.pathname }) });
                return;
            }
            const contentType = record.response.headers?.['content-type'] || 'application/json';
            const responseBody = contentType.includes('application/json')
                ? JSON.stringify(record.response.body) : String(record.response.body ?? '');
            await route.fulfill({
                status: record.response.status,
                contentType,
                body: responseBody,
            });
        });

        // Intercept EventSource connections (logs streaming).
        await page.route('**/api/logs/stream**', async route => {
            await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: \n\n' });
        });

        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        for (const view of VIEWS) {
            console.log(`Capturing ${view.name}...`);
            await page.goto(`${origin}${view.path}`, { waitUntil: 'networkidle' });

            // Wait for the view-specific content to appear.
            try {
                await page.waitForSelector(view.ready, { timeout: 10000 });
            } catch {
                console.warn(`  Warning: ready selector "${view.ready}" not found for ${view.name}, capturing anyway.`);
            }

            // Extra settle time for animations and lazy rendering.
            await page.waitForTimeout(500);

            await page.screenshot({
                path: resolve(screenshotsDir, `${view.name}.png`),
                fullPage: false,
            });
            console.log(`  Saved ${view.name}.png`);
        }

        if (errors.length) {
            console.error('Page errors during capture:', errors);
            process.exitCode = 1;
        }
    } finally {
        await browser.close();
        server.close();
    }

    console.log(`Generated ${VIEWS.length} screenshots in docs/src/screenshots/.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });

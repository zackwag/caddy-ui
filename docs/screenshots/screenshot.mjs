import { launchChromium } from '../../dev/browser.mjs';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createReplayFetch } from '../../dev/playground/capture-format.js';
import { serveDirectory } from '../scripts/static-server.mjs';
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

    const server = await serveDirectory(dist, { fallback: 'index.html' });
    const { port } = server.address();
    const origin = `http://127.0.0.1:${port}`;
    console.log(`Serving frontend at ${origin}`);

    let browser;
    try {
        browser = await launchChromium();
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

            if (errors.length) {
                throw new Error(`Screenshot ${view.name} failed: ${errors.join('\n')}`);
            }

            await page.screenshot({
                path: resolve(outputDirectory, `${view.name}.png`),
                fullPage: false,
                animations: 'disabled',
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

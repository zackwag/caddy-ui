import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import logger from './logger.js';

const MAINTENANCE_PATH = process.env.MAINTENANCE_PATH || '/etc/caddy-ui/maintenance.json';
const WWW_PATH = process.env.WWW_PATH || '/etc/caddy-ui/www';
const MAINTENANCE_HTML = 'maintenance.html';

const DEFAULT_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Maintenance</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;background:#0d0f12;color:#c9d1e0}
.wrap{text-align:center;padding:2rem;max-width:480px}
h1{font-size:1.5rem;margin-bottom:.75rem;color:#fff}
p{color:#8a95a8;line-height:1.6}
.icon{font-size:2.5rem;margin-bottom:1rem}
</style>
</head>
<body>
<div class="wrap">
<div class="icon">🔧</div>
<h1>Under Maintenance</h1>
<p>This site is temporarily offline for scheduled maintenance. Please check back shortly.</p>
</div>
</body>
</html>`;

let _state = {};
let _writeLock = Promise.resolve();

export async function loadMaintenance() {
    try {
        const raw = await readFile(MAINTENANCE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            _state = parsed;
            return _state;
        }
    } catch { }
    _state = {};
    return _state;
}

export function getMaintenanceState() {
    return { ..._state };
}

export function isInMaintenance(domain) {
    return !!_state[domain];
}

export async function setMaintenance(domain, originalContent) {
    _state[domain] = { originalContent, enabledAt: new Date().toISOString() };
    await _flush();
    logger.info('Maintenance enabled', { domain });
}

export async function clearMaintenance(domain) {
    const entry = _state[domain];
    delete _state[domain];
    await _flush();
    logger.info('Maintenance disabled', { domain });
    return entry;
}

async function _flush() {
    _writeLock = _writeLock.then(async () => {
        await mkdir(dirname(MAINTENANCE_PATH), { recursive: true });
        await writeFile(MAINTENANCE_PATH, JSON.stringify(_state, null, 2), 'utf8');
    });
    await _writeLock;
}

export async function getMaintenancePage() {
    const filePath = join(WWW_PATH, MAINTENANCE_HTML);
    try {
        return await readFile(filePath, 'utf8');
    } catch {
        await mkdir(WWW_PATH, { recursive: true });
        await writeFile(filePath, DEFAULT_PAGE, 'utf8');
        logger.info('Created default maintenance page', { path: filePath });
        return DEFAULT_PAGE;
    }
}

// Caddyfile backtick strings have no escape sequences, so a page containing a
// backtick would end the token early. A heredoc takes the page verbatim; its
// marker only has to not appear in the page. Caddy strips the closing marker's
// indentation from every line, so the page can be indented to fit the block.
export function buildMaintenanceBlock(domain, html) {
    let marker = 'CADDY_UI_MAINTENANCE';
    while (html.includes(marker)) marker += '_';
    const indent = ' '.repeat(8);
    const lines = [];
    lines.push(`${domain} {`);
    lines.push(`    header Content-Type text/html`);
    lines.push(`    respond <<${marker}`);
    for (const line of html.split(/\r?\n/)) lines.push(line ? indent + line : '');
    lines.push(`${indent}${marker} 503`);
    lines.push(`}`);
    return lines.join('\n');
}

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

const STATE_VERSION = 2;

// instances: instanceId -> domain -> { originalContent, enabledAt }
// unassigned: [{ domain, originalContent, enabledAt, instanceId? }] -- entries
// whose owner isn't known: saved before state was per instance, or left by a
// removed instance. They're only assigned when the owner can be proven.
let _state = { instances: {}, unassigned: [] };
let _writeLock = Promise.resolve();
const _reportedUnassigned = new Set();

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

export async function loadMaintenance() {
    _state = { instances: {}, unassigned: [] };
    try {
        const parsed = JSON.parse(await readFile(MAINTENANCE_PATH, 'utf8'));
        if (isObject(parsed) && parsed.version === STATE_VERSION) {
            if (isObject(parsed.instances)) _state.instances = parsed.instances;
            if (Array.isArray(parsed.unassigned)) _state.unassigned = parsed.unassigned;
        } else if (isObject(parsed)) {
            // Version 1 was keyed by domain alone, so its owner is unknown
            for (const [domain, entry] of Object.entries(parsed)) {
                if (isObject(entry)) _state.unassigned.push({ domain, ...entry });
            }
        }
    } catch { }
    return _state;
}

export function getMaintenanceState(instanceId) {
    return { ...(_state.instances[instanceId] || {}) };
}

export function isInMaintenance(instanceId, domain) {
    return !!_state.instances[instanceId]?.[domain];
}

export async function setMaintenance(instanceId, domain, originalContent) {
    _state.instances[instanceId] = { ...(_state.instances[instanceId] || {}), [domain]: { originalContent, enabledAt: new Date().toISOString() } };
    await _flush();
    logger.info('Maintenance enabled', { instance: instanceId, domain });
}

export async function clearMaintenance(instanceId, domain) {
    const entry = _state.instances[instanceId]?.[domain];
    if (!entry) return undefined;
    delete _state.instances[instanceId][domain];
    if (Object.keys(_state.instances[instanceId]).length === 0) delete _state.instances[instanceId];
    await _flush();
    logger.info('Maintenance disabled', { instance: instanceId, domain });
    return entry;
}

// A removed instance's saved site blocks are kept rather than dropped (they
// may be the only copy) but unassigned, so a new instance reusing the id
// can't restore them.
export async function releaseInstanceMaintenance(instanceId) {
    const entries = _state.instances[instanceId];
    if (!entries) return;
    for (const [domain, entry] of Object.entries(entries)) _state.unassigned.push({ domain, ...entry, instanceId });
    delete _state.instances[instanceId];
    await _flush();
    logger.info('Maintenance state unassigned for removed instance', { instance: instanceId, domains: Object.keys(entries) });
}

// Assigns an unassigned entry only when exactly one configured instance is
// currently serving the maintenance page for its domain, and no other
// unassigned entry shares that domain. servesMaintenance(instance, domain)
// resolves to true/false, or null when the instance's Caddyfile can't be read,
// which leaves the entry for a later attempt.
export async function claimUnassignedMaintenance(instances, servesMaintenance) {
    const counts = new Map();
    for (const { domain } of _state.unassigned) counts.set(domain, (counts.get(domain) || 0) + 1);
    let claimed = false;
    for (const [domain, count] of counts) {
        const results = await Promise.all(instances.map(inst => servesMaintenance(inst, domain)));
        const owners = instances.filter((_, i) => results[i] === true);
        const owner = count === 1 && !results.includes(null) && owners.length === 1 ? owners[0] : null;
        const index = _state.unassigned.findIndex(e => e.domain === domain);
        if (!owner || index === -1 || isInMaintenance(owner.id, domain)) {
            if (!results.includes(null) && !_reportedUnassigned.has(domain)) {
                _reportedUnassigned.add(domain);
                logger.warn('Saved maintenance state has no provable owner; it is kept in the maintenance file for manual recovery', {
                    domain, path: MAINTENANCE_PATH, candidates: owners.map(inst => inst.id),
                });
            }
            continue;
        }
        const [{ originalContent, enabledAt }] = _state.unassigned.splice(index, 1);
        _state.instances[owner.id] = { ...(_state.instances[owner.id] || {}), [domain]: { originalContent, enabledAt } };
        claimed = true;
        logger.info('Assigned saved maintenance state to the instance serving it', { instance: owner.id, domain });
    }
    if (claimed) await _flush();
}

export function hasUnassignedMaintenance() {
    return _state.unassigned.length > 0;
}

async function _flush() {
    _writeLock = _writeLock.then(async () => {
        await mkdir(dirname(MAINTENANCE_PATH), { recursive: true });
        await writeFile(MAINTENANCE_PATH, JSON.stringify({ version: STATE_VERSION, ..._state }, null, 2), 'utf8');
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

// Recognizes a site block written by buildMaintenanceBlock.
export function isMaintenanceBlock(block) {
    return typeof block === 'string' && /^\s*respond <<CADDY_UI_MAINTENANCE_*\s*$/m.test(block);
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

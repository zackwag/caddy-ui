import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { caddyfileChildren } from './caddyfileBlocks.js';
import { readSites } from './caddyfileChange.js';
import { extractSiteBlock } from './caddyfileSites.js';
import { getInstances } from './instances.js';
import { createJsonStore } from './jsonFile.js';
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

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

// instances: instanceId -> domain -> { originalContent, enabledAt }
// unassigned: [{ domain, originalContent, enabledAt, instanceId? }] -- entries
// whose owner isn't known: saved before state was per instance, or left by a
// removed instance. They're only assigned when the owner can be proven.
function parseMaintenance(parsed) {
    const state = { instances: {}, unassigned: [] };
    if (isObject(parsed) && parsed.version === STATE_VERSION) {
        if (isObject(parsed.instances)) state.instances = parsed.instances;
        if (Array.isArray(parsed.unassigned)) state.unassigned = parsed.unassigned;
    } else if (isObject(parsed)) {
        // Version 1 was keyed by domain alone, so its owner is unknown
        for (const [domain, entry] of Object.entries(parsed)) {
            if (isObject(entry)) state.unassigned.push({ domain, ...entry });
        }
    }
    return state;
}

const store = createJsonStore(MAINTENANCE_PATH, {
    parse: parseMaintenance,
    serialize: state => ({ version: STATE_VERSION, ...state }),
});
const _reportedUnassigned = new Set();

export async function loadMaintenance() {
    const state = await store.load();
    try { await getMaintenancePage(); }
    catch (e) { logger.warn('Could not initialize maintenance page; the endpoint fallback will be used', { error: e.message }); }
    return state;
}

export function getMaintenanceState(instanceId) {
    return { ...(store.get().instances[instanceId] || {}) };
}

export function isInMaintenance(instanceId, domain) {
    return !!store.get().instances[instanceId]?.[domain];
}

export async function setMaintenance(instanceId, domain, originalContent) {
    await store.update(state => {
        state.instances[instanceId] = { ...(state.instances[instanceId] || {}), [domain]: { originalContent, enabledAt: new Date().toISOString() } };
    });
    logger.info('Maintenance enabled', { instance: instanceId, domain });
}

export async function clearMaintenance(instanceId, domain) {
    const entry = store.get().instances[instanceId]?.[domain];
    if (!entry) return undefined;
    await store.update(state => {
        delete state.instances[instanceId][domain];
        if (Object.keys(state.instances[instanceId]).length === 0) delete state.instances[instanceId];
    });
    logger.info('Maintenance disabled', { instance: instanceId, domain });
    return entry;
}

// A removed instance's saved site blocks are kept rather than dropped (they
// may be the only copy) but unassigned, so a new instance reusing the id
// can't restore them.
export async function releaseInstanceMaintenance(instanceId) {
    const entries = store.get().instances[instanceId];
    if (!entries) return;
    await store.update(state => {
        for (const [domain, entry] of Object.entries(entries)) state.unassigned.push({ domain, ...entry, instanceId });
        delete state.instances[instanceId];
    });
    logger.info('Maintenance state unassigned for removed instance', { instance: instanceId, domains: Object.keys(entries) });
}

// Assigns an unassigned entry only when exactly one configured instance is
// currently serving the maintenance page for its domain, and no other
// unassigned entry shares that domain. servesMaintenance(instance, domain)
// resolves to true/false, or null when the instance's Caddyfile can't be read,
// which leaves the entry for a later attempt.
export async function claimUnassignedMaintenance(instances, servesMaintenance) {
    const counts = new Map();
    for (const { domain } of store.get().unassigned) counts.set(domain, (counts.get(domain) || 0) + 1);
    const claims = [];
    for (const [domain, count] of counts) {
        const results = await Promise.all(instances.map(inst => servesMaintenance(inst, domain)));
        const owners = instances.filter((_, i) => results[i] === true);
        const owner = count === 1 && !results.includes(null) && owners.length === 1 ? owners[0] : null;
        if (!owner || isInMaintenance(owner.id, domain)) {
            if (!results.includes(null) && !_reportedUnassigned.has(domain)) {
                _reportedUnassigned.add(domain);
                logger.warn('Saved maintenance state has no provable owner; it is kept in the maintenance file for manual recovery', {
                    domain, path: MAINTENANCE_PATH, candidates: owners.map(inst => inst.id),
                });
            }
            continue;
        }
        claims.push({ domain, owner });
    }
    if (!claims.length) return;
    await store.update(state => {
        let claimed = false;
        for (const { domain, owner } of claims) {
            const index = state.unassigned.findIndex(e => e.domain === domain);
            if (index === -1 || state.instances[owner.id]?.[domain]) continue;
            const [{ originalContent, enabledAt }] = state.unassigned.splice(index, 1);
            state.instances[owner.id] = { ...(state.instances[owner.id] || {}), [domain]: { originalContent, enabledAt } };
            claimed = true;
            logger.info('Assigned saved maintenance state to the instance serving it', { instance: owner.id, domain });
        }
        return claimed ? undefined : false;
    });
}

export function hasUnassignedMaintenance() {
    return store.get().unassigned.length > 0;
}

// Whether the instance's Caddyfile currently serves the maintenance page for
// the domain; null when the file can't be read. This is the only evidence used
// to assign saved state whose owner isn't recorded.
async function servesMaintenance(instance, domain) {
    try {
        const { caddyfile, env } = await readSites(instance);
        return isMaintenanceBlock(extractSiteBlock(caddyfile, domain, env));
    } catch {
        return null;
    }
}

// Whether the last claim couldn't read every instance's Caddyfile, so it's
// worth trying again, and how many claims are running.
let claimIncomplete = false;
let claimsRunning = 0;

// Run at startup and whenever an instance is saved, since either can make an
// owner provable. A claim that couldn't read some instance is retried by
// retrySavedMaintenanceClaim; entries that were read and match nothing aren't.
export async function claimSavedMaintenance() {
    claimsRunning++;
    let unreadable = false;
    const serves = async (instance, domain) => {
        const result = await servesMaintenance(instance, domain);
        if (result === null) {
            unreadable = true;
        }
        return result;
    };
    try {
        if (hasUnassignedMaintenance()) {
            await claimUnassignedMaintenance(getInstances(), serves);
        }
    } catch (err) {
        logger.warn('Could not assign saved maintenance state', { error: err.message });
    } finally {
        claimsRunning--;
    }
    claimIncomplete = unreadable;
}

// Called after monitor rounds: repeats a claim that couldn't read every
// instance, unless one is already running.
export function retrySavedMaintenanceClaim() {
    if (claimIncomplete && !claimsRunning) {
        return claimSavedMaintenance();
    }
}

export async function getMaintenancePage() {
    const filePath = join(WWW_PATH, MAINTENANCE_HTML);
    try {
        return await readFile(filePath, 'utf8');
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
        await mkdir(WWW_PATH, { recursive: true });
        await writeFile(filePath, DEFAULT_PAGE, 'utf8');
        logger.info('Created default maintenance page', { path: filePath });
        return DEFAULT_PAGE;
    }
}

// Recognizes a site block written by buildMaintenanceBlock (current or legacy).
export function isMaintenanceBlock(block) {
    if (typeof block !== 'string') return false;
    if (/^\s*rewrite \* \/public\/responses\/maintenance\s*$/m.test(block)) return true;
    // Legacy: inlined heredoc from before the responses endpoint
    if (/^\s*respond <<CADDY_UI_MAINTENANCE_*\s*$/m.test(block)) return true;
    return false;
}

const INFRA_DIRECTIVES = new Set([
    'tls', 'encode', 'header', 'log', 'bind', 'skip_log',
]);

export function buildMaintenanceBlock(originalBlock, backendUrl) {
    let entry;
    try { [entry] = caddyfileChildren(originalBlock); } catch { /* fallback below */ }
    if (!entry?.block) {
        const addr = originalBlock.trim().replace(/\s*\{[\s\S]*/, '');
        return `${addr} {\n    rewrite * /public/responses/maintenance\n    reverse_proxy ${backendUrl}\n}`;
    }
    const header = originalBlock.slice(0, entry.block.start + 1);
    const inner = entry.block.inner;

    let kept = inner;
    try {
        const children = caddyfileChildren(inner);
        const ranges = children
            .filter(child => !INFRA_DIRECTIVES.has(child.name) && !child.name?.startsWith('@'))
            .map(child => {
                const lineStart = inner.lastIndexOf('\n', child.start - 1) + 1;
                const nl = inner.indexOf('\n', child.end);
                return { start: lineStart, end: nl === -1 ? inner.length : nl + 1 };
            });
        for (const r of ranges.reverse()) kept = kept.slice(0, r.start) + kept.slice(r.end);
    } catch { /* parse failure: keep inner as-is, maintenance directives still get appended */ }

    kept = kept.replace(/\n{3,}/g, '\n\n').trim();
    return kept
        ? `${header.trimEnd()}\n${kept}\n    rewrite * /public/responses/maintenance\n    reverse_proxy ${backendUrl}\n}`
        : `${header.trimEnd()}\n    rewrite * /public/responses/maintenance\n    reverse_proxy ${backendUrl}\n}`;
}

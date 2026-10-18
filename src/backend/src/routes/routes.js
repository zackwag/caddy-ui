import { Router } from 'express';
import { caddyDelete, caddyGet, caddyPatch, caddyPost, caddyPut } from '../caddy.js';
import { caddyfileTitlesEnabled, extractTitleComment, injectTitleComment } from '../caddyfileTitles.js';
import { readContainerFile } from '../containerFs.js';
import { getCaddyEnv, resolveEnvVars } from '../docker.js';
import { getInstances } from '../instances.js';
import logger from '../logger.js';
import {
    buildMaintenanceBlock, claimUnassignedMaintenance, clearMaintenance, getMaintenancePage, getMaintenanceState,
    hasUnassignedMaintenance, isInMaintenance, isMaintenanceBlock, setMaintenance,
} from '../maintenance.js';
import { validateContainerName, validatePath } from '../validation.js';
import { saveRouteEdit } from './caddyfile.js';

const router = Router();

function buildReverseProxyRoute({ id, domain, upstream, stripPrefix }) {
    const matchers = [{ host: [domain] }];
    if (stripPrefix) matchers.push({ path: [`${stripPrefix}/*`] });

    return {
        '@id': id,
        match: matchers,
        handle: [
            {
                handler: 'subroute',
                routes: [
                    {
                        handle: [
                            {
                                handler: 'reverse_proxy',
                                upstreams: [{ dial: upstream }],
                            },
                        ],
                    },
                ],
            },
        ],
        terminal: true,
    };
}

function buildCaddyfileBlock({ domain, upstream, stripPrefix }) {
    const lines = [];
    lines.push(`${domain} {`);
    if (stripPrefix) {
        lines.push(`    handle ${stripPrefix}/* {`);
        lines.push(`        reverse_proxy ${upstream}`);
        lines.push(`    }`);
    } else {
        lines.push(`    reverse_proxy ${upstream}`);
    }
    lines.push(`}`);
    return lines.join('\n');
}

function matchesSiteAddress(trimmedLine, domain, env) {
    if (!trimmedLine.endsWith('{')) return false;
    const addr = trimmedLine.slice(0, -1).trim();
    const resolved = env ? resolveEnvVars(addr, env) : addr;
    const bare = resolved.replace(/^https?:\/\//, '');
    return bare === domain;
}

function removeSiteBlock(caddyfile, domain, env) {
    const lines = caddyfile.split('\n');
    const result = [];
    let skip = false;
    let depth = 0;
    let pendingBlank = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (!skip) {
            if (matchesSiteAddress(trimmed, domain, env)) {
                skip = true;
                depth = 1;
                pendingBlank = false;
                continue;
            }
            if (trimmed === '') {
                pendingBlank = true;
                continue;
            }
            if (pendingBlank) {
                result.push('');
                pendingBlank = false;
            }
            result.push(line);
        } else {
            for (const ch of line) {
                if (ch === '{') depth++;
                if (ch === '}') depth--;
            }
            if (depth === 0) skip = false;
        }
    }

    return result.join('\n').trimEnd() + '\n';
}

function replaceSiteBlock(caddyfile, oldDomain, newBlock, env) {
    const cleaned = removeSiteBlock(caddyfile, oldDomain, env);
    return `${cleaned.trimEnd()}\n\n${newBlock}\n`;
}

function extractSiteBlock(caddyfile, domain, env) {
    const lines = caddyfile.split('\n');
    const result = [];
    let found = false;
    let depth = 0;

    for (const line of lines) {
        const trimmed = line.trim();

        if (!found) {
            if (matchesSiteAddress(trimmed, domain, env)) {
                found = true;
                depth = 1;
                result.push(line);
            }
        } else {
            result.push(line);
            for (const ch of line) {
                if (ch === '{') depth++;
                if (ch === '}') depth--;
            }
            if (depth === 0) break;
        }
    }

    return found ? result.join('\n') : null;
}

function isSimpleReverseProxy(route) {
    const subroute = route.handle?.find(h => h.handler === 'subroute');
    if (!subroute) return false;
    const innerRoutes = subroute.routes ?? [];
    if (innerRoutes.length !== 1) return false;
    const handles = innerRoutes[0].handle ?? [];
    if (handles.length !== 1) return false;
    return handles[0].handler === 'reverse_proxy';
}

async function getAllServers(adminUrl) {
    try {
        const config = await caddyGet('/config/apps/http/servers', adminUrl);
        return config || {};
    } catch {
        return {};
    }
}

// Caddy happily accepts routes for a server ID that doesn't exist, creating a
// server with no listen address -- so the route never serves traffic. Returns
// an error message for that case, or null when the primary server exists.
function checkPrimaryServer(servers, primaryServer) {
    const ids = Object.keys(servers || {});
    if (ids.includes(primaryServer)) return null;
    if (!ids.length) {
        return 'Caddy has no HTTP servers yet. Add a site to the Caddyfile first, then add routes here.';
    }
    return `Primary server "${primaryServer}" doesn't exist in Caddy (available: ${ids.join(', ')}). `
        + 'Update the instance\'s Primary Server ID on the Instances page.';
}

// GET /api/routes
router.get('/', async (req, res) => {
    try {
        const servers = await getAllServers(req.instance.adminUrl);
        const allRoutes = [];

        for (const [serverName, server] of Object.entries(servers)) {
            const routes = server.routes || [];
            for (const route of routes) {
                allRoutes.push({
                    ...route,
                    _server: serverName,
                    _simpleProxy: isSimpleReverseProxy(route),
                });
            }
        }

        res.json(allRoutes);
    } catch {
        res.json([]);
    }
});

// POST /api/routes
router.post('/', async (req, res) => {
    const { domain, upstream, stripPrefix } = req.body;
    if (!domain || !upstream) {
        return res.status(400).json({ error: 'domain and upstream are required' });
    }
    logger.info(`Adding route`, { domain, upstream, stripPrefix });

    const primaryServer = req.instance.serverName;
    // Unlike getAllServers, let an unreachable Caddy surface as an error
    // rather than reading as "no servers"
    const servers = (await caddyGet('/config/apps/http/servers', req.instance.adminUrl)) || {};
    const serverError = checkPrimaryServer(servers, primaryServer);
    if (serverError) {
        logger.warn('Route not added: primary server missing', { primaryServer, servers: Object.keys(servers) });
        return res.status(400).json({ error: serverError });
    }

    const id = `route-${Date.now()}`;
    const route = buildReverseProxyRoute({ id, domain, upstream, stripPrefix });
    const configPath = req.instance.configPath;

    const routesPath = `/config/apps/http/servers/${primaryServer}/routes`;
    if (!servers[primaryServer].routes) {
        await caddyPut(routesPath, [route], req.instance.adminUrl);
    } else {
        await caddyPost(routesPath, route, req.instance.adminUrl);
    }

    const caddyfile = await readContainerFile(req.instance.containerName, configPath);
    const block = buildCaddyfileBlock({ domain, upstream, stripPrefix });
    await saveRouteEdit(req.instance, `${caddyfile.trimEnd()}\n\n${block}\n`, { reload: false });

    logger.info(`Route added`, { id, domain, upstream });
    res.status(201).json({ ok: true, id, route });
});

// GET /api/routes/caddyfile/:domain -- get site block content
router.get('/caddyfile/:domain', async (req, res) => {
    const { domain } = req.params;
    try {
        const [caddyfile, env] = await Promise.all([
            readContainerFile(req.instance.containerName, req.instance.configPath),
            getCaddyEnv(req.instance.containerName),
        ]);
        const block = extractSiteBlock(caddyfile, domain, env);
        if (!block) return res.status(404).json({ error: 'site block not found' });

        if (caddyfileTitlesEnabled()) {
            const { title, content } = extractTitleComment(block);
            return res.json({ content, title });
        }

        res.json({ content: block });
    } catch (e) {
        logger.error('Failed to read site block', { domain, error: e.message });
        res.status(500).json({ error: e.message });
    }
});

// PATCH /api/routes/caddyfile/:domain -- update a Caddyfile-managed route
router.patch('/caddyfile/:domain', async (req, res) => {
    const { domain } = req.params;
    const { content, title } = req.body;
    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'content is required' });
    }

    try {
        const [caddyfile, env] = await Promise.all([
            readContainerFile(req.instance.containerName, req.instance.configPath),
            getCaddyEnv(req.instance.containerName),
        ]);
        const existing = extractSiteBlock(caddyfile, domain, env);
        if (!existing) return res.status(404).json({ error: 'site block not found' });

        let finalContent = content.trim();
        if (caddyfileTitlesEnabled()) {
            finalContent = injectTitleComment(finalContent, title);
        }

        const cleaned = removeSiteBlock(caddyfile, domain, env);
        const updated = `${cleaned.trimEnd()}\n\n${finalContent}\n`;
        await saveRouteEdit(req.instance, updated);

        logger.info('Caddyfile site block updated', { domain });
        res.json({ ok: true, domain });
    } catch (e) {
        logger.error('Failed to update site block', { domain, error: e.message });
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/routes/caddyfile/:domain -- remove a site block from the Caddyfile
router.delete('/caddyfile/:domain', async (req, res) => {
    const { domain } = req.params;
    try {
        const [caddyfile, env] = await Promise.all([
            readContainerFile(req.instance.containerName, req.instance.configPath),
            getCaddyEnv(req.instance.containerName),
        ]);
        const existing = extractSiteBlock(caddyfile, domain, env);
        if (!existing) return res.status(404).json({ error: 'site block not found' });

        const cleaned = removeSiteBlock(caddyfile, domain, env);
        await saveRouteEdit(req.instance, cleaned);

        logger.info('Caddyfile site block deleted', { domain });
        res.json({ ok: true, domain });
    } catch (e) {
        logger.error('Failed to delete site block', { domain, error: e.message });
        res.status(500).json({ error: e.message });
    }
});

// PATCH /api/routes/:id -- update a UI-managed route (@id exists)
router.patch('/:id', async (req, res) => {
    const { id } = req.params;
    const { domain, upstream, stripPrefix } = req.body;
    if (!domain || !upstream) {
        return res.status(400).json({ error: 'domain and upstream are required' });
    }
    logger.info(`Updating route`, { id, domain, upstream });

    let oldDomain = null;
    try {
        const oldRoute = await caddyGet(`/id/${id}`, req.instance.adminUrl);
        oldDomain = oldRoute?.match?.[0]?.host?.[0] || null;
    } catch {
        logger.warn(`Could not fetch old route for update`, { id });
    }

    const route = buildReverseProxyRoute({ id, domain, upstream, stripPrefix });
    await caddyPatch(`/id/${id}`, route, req.instance.adminUrl);

    if (oldDomain) {
        const [caddyfile, env] = await Promise.all([
            readContainerFile(req.instance.containerName, req.instance.configPath),
            getCaddyEnv(req.instance.containerName),
        ]);
        const newBlock = buildCaddyfileBlock({ domain, upstream, stripPrefix });
        const updated = replaceSiteBlock(caddyfile, oldDomain, newBlock, env);
        await saveRouteEdit(req.instance, updated, { reload: false });
    }

    logger.info(`Route updated`, { id, domain, upstream });
    res.json({ ok: true, id, route });
});

// DELETE /api/routes/:id
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    logger.info(`Deleting route`, { id });

    let domain = null;
    try {
        const route = await caddyGet(`/id/${id}`, req.instance.adminUrl);
        domain = route?.match?.[0]?.host?.[0] || null;
    } catch {
        logger.warn(`Could not fetch route for deletion`, { id });
    }

    await caddyDelete(`/id/${id}`, req.instance.adminUrl);

    if (domain) {
        const [caddyfile, env] = await Promise.all([
            readContainerFile(req.instance.containerName, req.instance.configPath),
            getCaddyEnv(req.instance.containerName),
        ]);
        const cleaned = removeSiteBlock(caddyfile, domain, env);
        await saveRouteEdit(req.instance, cleaned, { reload: false });
    }

    logger.info(`Route deleted`, { id, domain });
    res.json({ ok: true, id });
});

// Whether the instance's Caddyfile currently serves the maintenance page for
// the domain; null when the file can't be read. This is the only evidence used
// to assign saved state whose owner isn't recorded.
async function servesMaintenance(instance, domain) {
    try {
        const containerName = validateContainerName(instance.containerName);
        const [caddyfile, env] = await Promise.all([
            readContainerFile(containerName, validatePath(instance.configPath)),
            getCaddyEnv(containerName),
        ]);
        return isMaintenanceBlock(extractSiteBlock(caddyfile, domain, env));
    } catch {
        return null;
    }
}

async function claimSavedMaintenance() {
    if (hasUnassignedMaintenance()) await claimUnassignedMaintenance(getInstances(), servesMaintenance);
}

// GET /api/routes/maintenance -- maintenance state for the selected instance's domains
router.get('/maintenance', async (req, res) => {
    await claimSavedMaintenance();
    res.json(getMaintenanceState(req.instance.id));
});

// POST /api/routes/caddyfile/:domain/maintenance -- enable maintenance mode
router.post('/caddyfile/:domain/maintenance', async (req, res) => {
    const { domain } = req.params;
    await claimSavedMaintenance();
    if (isInMaintenance(req.instance.id, domain)) {
        return res.status(409).json({ error: 'Route is already in maintenance mode' });
    }

    try {
        const [caddyfile, env] = await Promise.all([
            readContainerFile(req.instance.containerName, req.instance.configPath),
            getCaddyEnv(req.instance.containerName),
        ]);
        const block = extractSiteBlock(caddyfile, domain, env);
        if (!block) return res.status(404).json({ error: 'site block not found' });
        // Saving the maintenance page as the "original" would lose the real block
        if (isMaintenanceBlock(block)) {
            return res.status(409).json({ error: 'Route is already serving the maintenance page' });
        }

        const html = await getMaintenancePage();
        const maintBlock = buildMaintenanceBlock(domain, html);

        const cleaned = removeSiteBlock(caddyfile, domain, env);
        const updated = `${cleaned.trimEnd()}\n\n${maintBlock}\n`;
        await saveRouteEdit(req.instance, updated);

        await setMaintenance(req.instance.id, domain, block);

        logger.info('Maintenance mode enabled', { domain });
        res.json({ ok: true, domain });
    } catch (e) {
        logger.error('Failed to enable maintenance mode', { domain, error: e.message });
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/routes/caddyfile/:domain/maintenance -- disable maintenance mode
router.delete('/caddyfile/:domain/maintenance', async (req, res) => {
    const { domain } = req.params;
    await claimSavedMaintenance();
    if (!isInMaintenance(req.instance.id, domain)) {
        return res.status(404).json({ error: 'Route is not in maintenance mode' });
    }

    try {
        const [caddyfile, env] = await Promise.all([
            readContainerFile(req.instance.containerName, req.instance.configPath),
            getCaddyEnv(req.instance.containerName),
        ]);

        const { originalContent } = getMaintenanceState(req.instance.id)[domain];

        const cleaned = removeSiteBlock(caddyfile, domain, env);
        const updated = `${cleaned.trimEnd()}\n\n${originalContent}\n`;
        await saveRouteEdit(req.instance, updated);
        await clearMaintenance(req.instance.id, domain);

        logger.info('Maintenance mode disabled', { domain });
        res.json({ ok: true, domain });
    } catch (e) {
        logger.error('Failed to disable maintenance mode', { domain, error: e.message });
        res.status(500).json({ error: e.message });
    }
});

export default router;
export { buildReverseProxyRoute, buildCaddyfileBlock, checkPrimaryServer, removeSiteBlock, replaceSiteBlock, extractSiteBlock, isSimpleReverseProxy, buildMaintenanceBlock };

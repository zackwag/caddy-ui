import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { AppError, asAppError } from '../AppError.js';
import { caddyDelete, caddyGet, caddyPatch, caddyPost, caddyPut } from '../caddy.js';
import { caddyfileEntries, matchesSiteAddress } from '../caddyfileBlocks.js';
import { caddyfileTitlesEnabled, extractTitleComment, injectTitleComment } from '../caddyfileTitles.js';
import { readContainerFile } from '../containerFs.js';
import { getCaddyEnv, resolveEnvVars } from '../docker.js';
import { sendAppError } from '../errorReporting.js';
import { getInstances } from '../instances.js';
import logger from '../logger.js';
import {
    buildMaintenanceBlock, claimUnassignedMaintenance, clearMaintenance, getMaintenanceState,
    hasUnassignedMaintenance, isInMaintenance, isMaintenanceBlock, setMaintenance,
} from '../maintenance.js';
import { getBackendUrl } from '../dockerDiscovery.js';
import { getServers } from '../observations.js';
import { validateContainerName, validatePath } from '../validation.js';
import { historyWarning, queueCaddyfileChange, saveCaddyfileChange } from './caddyfile.js';
import { getAuthentication } from '../middleware/auth.js';

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

function siteEntries(caddyfile, domain, env) {
    const resolve = env ? address => resolveEnvVars(address, env) : undefined;
    return caddyfileEntries(caddyfile).filter(entry => matchesSiteAddress(entry, domain, resolve));
}

// Removes every top-level block for the domain and leaves the rest of the file
// as written, collapsing only the blank lines left where a block used to be.
function removeSiteBlock(caddyfile, domain, env) {
    let result = caddyfile;
    for (const entry of siteEntries(caddyfile, domain, env).reverse()) {
        const before = result.slice(0, entry.lineStart);
        let after = result.slice(entry.lineEnd).replace(/^\r?\n/, '');
        if (!before.trim() || /\n[ \t]*\r?\n$/.test(before)) after = after.replace(/^(?:[ \t]*\r?\n)+/, '');
        result = before + after;
    }
    return result.trimEnd() + '\n';
}

function replaceSiteBlock(caddyfile, oldDomain, newBlock, env) {
    const cleaned = removeSiteBlock(caddyfile, oldDomain, env);
    return `${cleaned.trimEnd()}\n\n${newBlock}\n`;
}

function extractSiteBlock(caddyfile, domain, env) {
    return siteEntries(caddyfile, domain, env)[0]?.text ?? null;
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

// GET /api/routes -- an empty list means Caddy has no HTTP routes. When the
// config can't be read the request fails, so an outage never looks empty.
router.get('/', async (req, res) => {
    let servers;
    try {
        servers = (await getServers(req.instance.adminUrl)) || {};
    } catch (err) {
        return sendAppError(res, asAppError(err, 'CADDY_CONFIG_UNAVAILABLE', { instanceId: req.instance.id }));
    }
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
});

// POST /api/routes
router.post('/', async (req, res) => {
    const { domain, upstream, stripPrefix } = req.body;
    if (!domain || !upstream) {
        return res.status(400).json({ error: 'domain and upstream are required' });
    }
    logger.info(`Adding route`, { domain, upstream, stripPrefix });

    const primaryServer = req.instance.serverName;
    // Let an unreachable Caddy surface as an error rather than reading as "no servers"
    const servers = (await caddyGet('/config/apps/http/servers', req.instance.adminUrl)) || {};
    const serverError = checkPrimaryServer(servers, primaryServer);
    if (serverError) {
        logger.warn('Route not added: primary server missing', { primaryServer, servers: Object.keys(servers) });
        return res.status(400).json({ error: serverError });
    }

    const id = `route-${randomUUID()}`;
    const route = buildReverseProxyRoute({ id, domain, upstream, stripPrefix });

    const routesPath = `/config/apps/http/servers/${primaryServer}/routes`;
    const addLive = async () => {
        const current = await caddyGet('/config/apps/http/servers', req.instance.adminUrl);
        if (checkPrimaryServer(current || {}, primaryServer)) throw new AppError('VALIDATION_FAILED');
        return current[primaryServer].routes ? caddyPost(routesPath, route, req.instance.adminUrl)
            : caddyPut(routesPath, [route], req.instance.adminUrl);
    };
    const block = buildCaddyfileBlock({ domain, upstream, stripPrefix });
    let result;
    // Written before the live change, so a rejected route restores the file
    // instead of leaving a running route the Caddyfile doesn't have
    try {
        result = await saveCaddyfileChange(req.instance, previous => `${(previous || '').trimEnd()}\n\n${block}\n`, { apply: addLive, actor: getAuthentication().getActor(req), action: 'route.add' });
    } catch (e) {
        if (e instanceof AppError) return sendAppError(res, e);
        throw e;
    }

    logger.info(`Route added`, { id, domain, upstream });
    res.status(201).json({ ok: true, id, route, ...historyWarning(result) });
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
        const result = await saveCaddyfileChange(req.instance, async previous => {
            const env = await getCaddyEnv(req.instance.containerName);
            if (!extractSiteBlock(previous || '', domain, env)) throw new AppError('NOT_FOUND');
            let finalContent = content.trim();
            if (caddyfileTitlesEnabled()) finalContent = injectTitleComment(finalContent, title);
            const cleaned = removeSiteBlock(previous, domain, env);
            return `${cleaned.trimEnd()}\n\n${finalContent}\n`;
        }, { actor: getAuthentication().getActor(req), action: 'route.edit' });

        logger.info('Caddyfile site block updated', { domain });
        res.json({ ok: true, domain, ...historyWarning(result) });
    } catch (e) {
        if (e instanceof AppError) return sendAppError(res, e);
        logger.error('Failed to update site block', { domain, error: e.message });
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/routes/caddyfile/:domain -- remove a site block from the Caddyfile
router.delete('/caddyfile/:domain', async (req, res) => {
    const { domain } = req.params;
    try {
        const result = await saveCaddyfileChange(req.instance, async previous => {
            const env = await getCaddyEnv(req.instance.containerName);
            if (!extractSiteBlock(previous || '', domain, env)) throw new AppError('NOT_FOUND');
            return removeSiteBlock(previous, domain, env);
        }, { actor: getAuthentication().getActor(req), action: 'route.delete' });

        logger.info('Caddyfile site block deleted', { domain });
        res.json({ ok: true, domain, ...historyWarning(result) });
    } catch (e) {
        if (e instanceof AppError) return sendAppError(res, e);
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

    const route = buildReverseProxyRoute({ id, domain, upstream, stripPrefix });
    const patchLive = () => caddyPatch(`/id/${id}`, route, req.instance.adminUrl);
    let result;
    try {
        result = await queueCaddyfileChange(req.instance, async save => {
            let oldDomain;
            try { oldDomain = (await caddyGet(`/id/${id}`, req.instance.adminUrl))?.match?.[0]?.host?.[0]; }
            catch { logger.warn('Could not fetch old route for update', { id }); }
            if (!oldDomain) { await patchLive(); return; }
            return save(async previous => {
                const env = await getCaddyEnv(req.instance.containerName);
                return replaceSiteBlock(previous || '', oldDomain, buildCaddyfileBlock({ domain, upstream, stripPrefix }), env);
            }, { apply: patchLive, actor: getAuthentication().getActor(req), action: 'route.edit' });
        });
    } catch (error) {
        if (error instanceof AppError) return sendAppError(res, error);
        throw error;
    }

    logger.info(`Route updated`, { id, domain, upstream });
    res.json({ ok: true, id, route, ...historyWarning(result) });
});

// DELETE /api/routes/:id
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    logger.info(`Deleting route`, { id });

    let domain;
    const deleteLive = () => caddyDelete(`/id/${id}`, req.instance.adminUrl);
    let result;
    try {
        result = await queueCaddyfileChange(req.instance, async save => {
            try { domain = (await caddyGet(`/id/${id}`, req.instance.adminUrl))?.match?.[0]?.host?.[0]; }
            catch { logger.warn('Could not fetch route for deletion', { id }); }
            if (!domain) { await deleteLive(); return; }
            return save(async previous => removeSiteBlock(previous || '', domain, await getCaddyEnv(req.instance.containerName)),
                { apply: deleteLive, actor: getAuthentication().getActor(req), action: 'route.delete' });
        });
    } catch (error) {
        if (error instanceof AppError) return sendAppError(res, error);
        throw error;
    }

    logger.info(`Route deleted`, { id, domain });
    res.json({ ok: true, id, ...historyWarning(result) });
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
    try {
        let block;
        const result = await saveCaddyfileChange(req.instance, async previous => {
            if (isInMaintenance(req.instance.id, domain)) throw new AppError('CONFLICT');
            const env = await getCaddyEnv(req.instance.containerName);
            block = extractSiteBlock(previous || '', domain, env);
            if (!block) throw new AppError('NOT_FOUND');
            if (isMaintenanceBlock(block)) throw new AppError('CONFLICT');
            const backendUrl = getBackendUrl();
            if (!backendUrl) throw new AppError('BACKEND_URL_UNKNOWN');
            const maintBlock = buildMaintenanceBlock(block, backendUrl);
            const cleaned = removeSiteBlock(previous, domain, env);
            return `${cleaned.trimEnd()}\n\n${maintBlock}\n`;
        }, { actor: getAuthentication().getActor(req), action: 'maintenance.enable',
            onApplied: () => setMaintenance(req.instance.id, domain, block) });

        logger.info('Maintenance mode enabled', { domain });
        res.json({ ok: true, domain, ...historyWarning(result) });
    } catch (e) {
        if (e instanceof AppError) return sendAppError(res, e);
        logger.error('Failed to enable maintenance mode', { domain, error: e.message });
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/routes/caddyfile/:domain/maintenance -- disable maintenance mode
router.delete('/caddyfile/:domain/maintenance', async (req, res) => {
    const { domain } = req.params;
    await claimSavedMaintenance();
    try {
        const result = await saveCaddyfileChange(req.instance, async previous => {
            if (!isInMaintenance(req.instance.id, domain)) throw new AppError('NOT_FOUND');
            const env = await getCaddyEnv(req.instance.containerName);
            const { originalContent } = getMaintenanceState(req.instance.id)[domain];
            const cleaned = removeSiteBlock(previous || '', domain, env);
            return `${cleaned.trimEnd()}\n\n${originalContent}\n`;
        }, { actor: getAuthentication().getActor(req), action: 'maintenance.disable',
            onApplied: () => clearMaintenance(req.instance.id, domain) });

        logger.info('Maintenance mode disabled', { domain });
        res.json({ ok: true, domain, ...historyWarning(result) });
    } catch (e) {
        if (e instanceof AppError) return sendAppError(res, e);
        logger.error('Failed to disable maintenance mode', { domain, error: e.message });
        res.status(500).json({ error: e.message });
    }
});

export default router;
export { buildReverseProxyRoute, buildCaddyfileBlock, checkPrimaryServer, removeSiteBlock, replaceSiteBlock, extractSiteBlock, isSimpleReverseProxy, buildMaintenanceBlock };

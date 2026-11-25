import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { AppError, asAppError } from '../AppError.js';
import { caddyDelete, caddyGet, caddyGetTagged, caddyPatch, caddyPost, caddyPut } from '../caddy.js';
import { changeResultFields, queueCaddyfileChange, saveCaddyfileChange } from '../caddyfileChange.js';
import { appendSiteBlock, extractSiteBlock, removeSiteBlock, replaceSiteBlock } from '../caddyfileSites.js';
import { caddyfileTitlesEnabled, extractTitleComment, injectTitleComment } from '../caddyfileTitles.js';
import { routeExpectation } from '../configExpectation.js';
import { verifyLiveObject, verifyLiveObjectRemoved } from '../configVerification.js';
import { readContainerFile } from '../containerFs.js';
import { getCaddyEnv } from '../docker.js';
import logger from '../logger.js';
import { getServers } from '../observations.js';
import { buildReverseProxyRoute, buildSiteBlock } from '../reverseProxyRoute.js';
import maintenanceRouter from './maintenance.js';

const router = Router();

router.use(maintenanceRouter);

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

// Admin API route edits send If-Match with the ETag of the read they're based
// on, so Caddy refuses them with 412 if that part of the config changed in
// between instead of overwriting someone else's change. That's a confirmed
// rejection, never retried: a retry would act on a state nobody reviewed.
// Without an ETag (Caddy before 2.6) the write is unconditional, as before.
function ifUnchanged(write) {
    return async () => {
        try {
            return await write();
        } catch (error) {
            if (error?.status === 412) {
                throw new AppError('CONFIG_CHANGED', { cause: error });
            }
            throw error;
        }
    };
}

// GET /api/routes -- an empty list means Caddy has no HTTP routes. When the
// config can't be read the request fails, so an outage never looks empty.
router.get('/', async (req, res) => {
    let servers;
    try {
        servers = (await getServers(req.instance.adminUrl)) || {};
    } catch (err) {
        throw asAppError(err, 'CADDY_CONFIG_UNAVAILABLE', { instanceId: req.instance.id });
    }
    res.json(Object.entries(servers).flatMap(([serverName, server]) =>
        (server.routes || []).map(route => ({ ...route, _server: serverName }))));
});

function requireTarget(req, res, next) {
    const { domain, upstream } = req.body;
    if (!domain || !upstream) {
        return res.status(400).json({ error: 'domain and upstream are required' });
    }
    next();
}

// POST /api/routes
router.post('/', requireTarget, async (req, res) => {
    const { domain, upstream, stripPrefix } = req.body;
    const { adminUrl, serverName: primaryServer } = req.instance;
    logger.info(`Adding route`, { domain, upstream, stripPrefix });

    // Let an unreachable Caddy surface as an error rather than reading as "no servers"
    const servers = (await caddyGet('/config/apps/http/servers', adminUrl)) || {};
    const serverError = checkPrimaryServer(servers, primaryServer);
    if (serverError) {
        logger.warn('Route not added: primary server missing', { primaryServer, servers: Object.keys(servers) });
        return res.status(400).json({ error: serverError });
    }

    const id = `route-${randomUUID()}`;
    const route = buildReverseProxyRoute({ id, domain, upstream, stripPrefix });
    const routesPath = `/config/apps/http/servers/${primaryServer}/routes`;
    const result = await queueCaddyfileChange(req.instance, async ({ save }) => {
        // Recheck inside the queue, before changing the file. A preflight
        // timeout cannot leave a saved route that was never sent to Caddy.
        let current, etag;
        try { ({ value: current, etag } = await caddyGetTagged('/config/apps/http/servers', adminUrl)); }
        catch (error) { throw asAppError(error, 'CADDY_CONFIG_UNAVAILABLE', { instanceId: req.instance.id }); }
        if (checkPrimaryServer(current || {}, primaryServer)) throw new AppError('VALIDATION_FAILED');
        // Caddy checks If-Match against the path the ETag names, so the
        // servers read guards the add, including the PUT that creates a
        // missing routes array (which has no ETag of its own yet).
        const addLive = ifUnchanged(() => current[primaryServer].routes
            ? caddyPost(routesPath, route, adminUrl, { ifMatch: etag })
            : caddyPut(routesPath, [route], adminUrl, { ifMatch: etag }));
        // The file still precedes the mutation, so a rejected write can
        // restore it and a dispatched write timeout can keep it.
        return save(previous => appendSiteBlock(previous, buildSiteBlock({ domain, upstream, stripPrefix })), {
            live: {
                apply: addLive,
                verify: () => verifyLiveObject(req.instance, id, route),
                expectLive: routeExpectation({ operation: 'add', serverName: primaryServer, route }),
            },
            actor: req.actor, action: 'route.add',
        });
    });

    logger.info(`Route added`, { id, domain, upstream });
    res.status(201).json({ ok: true, id, route, ...changeResultFields(result) });
});

// GET /api/routes/caddyfile/:domain -- get site block content
router.get('/caddyfile/:domain', async (req, res) => {
    const [caddyfile, env] = await Promise.all([
        readContainerFile(req.instance.containerName, req.instance.configPath),
        getCaddyEnv(req.instance.containerName),
    ]);
    const block = extractSiteBlock(caddyfile, req.params.domain, env);
    if (!block) return res.status(404).json({ error: 'site block not found' });

    if (caddyfileTitlesEnabled()) {
        const { title, content } = extractTitleComment(block);
        return res.json({ content, title });
    }

    res.json({ content: block });
});

// Changes the domain's site block: `edit(caddyfile, env)` gets a Caddyfile that
// has one and returns it changed.
function changeSite(req, domain, edit, options) {
    return saveCaddyfileChange(req.instance, async previous => {
        const env = await getCaddyEnv(req.instance.containerName);
        if (!extractSiteBlock(previous, domain, env)) throw new AppError('NOT_FOUND');
        return edit(previous, env);
    }, { actor: req.actor, ...options });
}

// PATCH /api/routes/caddyfile/:domain -- update a Caddyfile-managed route
router.patch('/caddyfile/:domain', async (req, res) => {
    const { domain } = req.params;
    const { content, title } = req.body;
    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'content is required' });
    }
    const block = caddyfileTitlesEnabled() ? injectTitleComment(content.trim(), title) : content.trim();
    const result = await changeSite(req, domain, (caddyfile, env) => replaceSiteBlock(caddyfile, domain, block, env), { action: 'route.edit' });
    logger.info('Caddyfile site block updated', { domain });
    res.json({ ok: true, domain, ...changeResultFields(result) });
});

// DELETE /api/routes/caddyfile/:domain -- remove a site block from the Caddyfile
router.delete('/caddyfile/:domain', async (req, res) => {
    const { domain } = req.params;
    const result = await changeSite(req, domain, (caddyfile, env) => removeSiteBlock(caddyfile, domain, env), { action: 'route.delete' });
    logger.info('Caddyfile site block deleted', { domain });
    res.json({ ok: true, domain, ...changeResultFields(result) });
});

// Changes a UI-managed route (one with an @id) and the site block it was added
// with. `liveChange(ifMatch)` is how it reaches the running config and
// `edit(caddyfile, domain, env)` how it reaches the file; a route whose domain
// can't be read has no block to find, so only the running config changes.
function changeManagedRoute(req, { liveChange, edit, action }) {
    const { id } = req.params;
    const { adminUrl, containerName } = req.instance;
    return queueCaddyfileChange(req.instance, async ({ save, applyLive }) => {
        let domain, etag;
        try {
            const read = await caddyGetTagged(`/id/${id}`, adminUrl);
            domain = read.value?.match?.[0]?.host?.[0];
            etag = read.etag;
        } catch {
            logger.warn('Could not read the route before changing it', { id, action });
        }
        const change = liveChange({ ifMatch: etag });
        const live = { ...change, apply: ifUnchanged(change.apply) };
        if (!domain) return applyLive(live);
        return save(async previous => edit(previous, domain, await getCaddyEnv(containerName)), { live, actor: req.actor, action });
    });
}

// PATCH /api/routes/:id -- update a UI-managed route
router.patch('/:id', requireTarget, async (req, res) => {
    const { id } = req.params;
    const { domain, upstream, stripPrefix } = req.body;
    logger.info(`Updating route`, { id, domain, upstream });

    const route = buildReverseProxyRoute({ id, domain, upstream, stripPrefix });
    const result = await changeManagedRoute(req, {
        liveChange: options => ({
            apply: () => caddyPatch(`/id/${id}`, route, req.instance.adminUrl, options),
            verify: () => verifyLiveObject(req.instance, id, route),
            expectLive: routeExpectation({ operation: 'replace', id, route }),
        }),
        edit: (caddyfile, oldDomain, env) => replaceSiteBlock(caddyfile, oldDomain, buildSiteBlock({ domain, upstream, stripPrefix }), env),
        action: 'route.edit',
    });

    logger.info(`Route updated`, { id, domain, upstream });
    res.json({ ok: true, id, route, ...changeResultFields(result) });
});

// DELETE /api/routes/:id
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    logger.info(`Deleting route`, { id });

    const result = await changeManagedRoute(req, {
        liveChange: options => ({
            apply: () => caddyDelete(`/id/${id}`, req.instance.adminUrl, options),
            verify: () => verifyLiveObjectRemoved(req.instance, id),
            expectLive: routeExpectation({ operation: 'remove', id }),
        }),
        edit: removeSiteBlock,
        action: 'route.delete',
    });

    logger.info(`Route deleted`, { id });
    res.json({ ok: true, id, ...changeResultFields(result) });
});

export default router;
export { checkPrimaryServer };

import { Router } from 'express';
import { AppError, asAppError } from '../AppError.js';
import { changeResultFields, readSites } from '../caddyfileChange.js';
import { extractSiteBlock, removeSiteBlock, replaceSiteBlock } from '../caddyfileSites.js';
import { caddyfileTitlesEnabled, extractTitleComment, injectTitleComment } from '../caddyfileTitles.js';
import logger from '../logger.js';
import { addManagedRoute, changeSite, deleteManagedRoute, updateManagedRoute } from '../managedRoutes.js';
import { getServers } from '../observations.js';
import { getListenPort } from '../routeChecks.js';
import maintenanceRouter from './maintenance.js';

const router = Router();

router.use(maintenanceRouter);

// GET /api/routes -- an empty list means Caddy has no HTTP routes. When the
// config can't be read the request fails, so an outage never looks empty.
// `_listenPort` is the port route checks use, null when they skip the server.
router.get('/', async (req, res) => {
    let servers;
    try {
        servers = (await getServers(req.instance.adminUrl)) || {};
    } catch (err) {
        throw asAppError(err, 'CADDY_CONFIG_UNAVAILABLE', { instanceId: req.instance.id });
    }
    res.json(Object.entries(servers).flatMap(([serverName, server]) =>
        (server.routes || []).map(route => ({ ...route, _server: serverName, _listenPort: getListenPort(server) }))));
});

function requireTarget(req, res, next) {
    for (const field of ['domain', 'upstream']) {
        if (!req.body?.[field]) {
            throw new AppError('VALIDATION_FAILED', { context: { field } });
        }
    }
    next();
}

// POST /api/routes
router.post('/', requireTarget, async (req, res) => {
    const { domain, upstream, stripPrefix } = req.body;
    logger.info(`Adding route`, { domain, upstream, stripPrefix });
    const { id, route, result } = await addManagedRoute(req.instance, { domain, upstream, stripPrefix }, req.actor);
    logger.info(`Route added`, { id, domain, upstream });
    res.status(201).json({ ok: true, id, route, ...changeResultFields(result) });
});

// GET /api/routes/caddyfile/:domain -- get site block content
router.get('/caddyfile/:domain', async (req, res) => {
    const { caddyfile, env } = await readSites(req.instance);
    const block = extractSiteBlock(caddyfile, req.params.domain, env);
    if (!block) {
        throw new AppError('NOT_FOUND');
    }

    if (caddyfileTitlesEnabled()) {
        const { title, content } = extractTitleComment(block);
        return res.json({ content, title });
    }

    res.json({ content: block });
});

// PATCH /api/routes/caddyfile/:domain -- update a Caddyfile-managed route
router.patch('/caddyfile/:domain', async (req, res) => {
    const { domain } = req.params;
    const { content, title } = req.body;
    if (typeof content !== 'string' || !content.trim()) {
        throw new AppError('VALIDATION_FAILED', { context: { field: 'content' } });
    }
    const block = caddyfileTitlesEnabled() ? injectTitleComment(content.trim(), title) : content.trim();
    const result = await changeSite(req.instance, domain, (caddyfile, env) => replaceSiteBlock(caddyfile, domain, block, env),
        { actor: req.actor, action: 'route.edit' });
    logger.info('Caddyfile site block updated', { domain });
    res.json({ ok: true, domain, ...changeResultFields(result) });
});

// DELETE /api/routes/caddyfile/:domain -- remove a site block from the Caddyfile
router.delete('/caddyfile/:domain', async (req, res) => {
    const { domain } = req.params;
    const result = await changeSite(req.instance, domain, (caddyfile, env) => removeSiteBlock(caddyfile, domain, env),
        { actor: req.actor, action: 'route.delete' });
    logger.info('Caddyfile site block deleted', { domain });
    res.json({ ok: true, domain, ...changeResultFields(result) });
});

// PATCH /api/routes/:id -- update a UI-managed route
router.patch('/:id', requireTarget, async (req, res) => {
    const { id } = req.params;
    const { domain, upstream, stripPrefix } = req.body;
    logger.info(`Updating route`, { id, domain, upstream });
    const { route, result } = await updateManagedRoute(req.instance, id, { domain, upstream, stripPrefix }, req.actor);
    logger.info(`Route updated`, { id, domain, upstream });
    res.json({ ok: true, id, route, ...changeResultFields(result) });
});

// DELETE /api/routes/:id
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    logger.info(`Deleting route`, { id });
    const result = await deleteManagedRoute(req.instance, id, req.actor);
    logger.info(`Route deleted`, { id });
    res.json({ ok: true, id, ...changeResultFields(result) });
});

export default router;

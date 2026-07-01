import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { caddyDelete, caddyGet, caddyPatch, caddyPost, caddyPut } from '../caddy.js';
import logger from '../logger.js';

const router = Router();

const PRIMARY_SERVER = process.env.CADDY_SERVER_NAME || 'srv0';
const CADDY_CONFIG_PATH = process.env.CADDY_CONFIG_PATH || '/etc/caddy/Caddyfile';

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

function removeSiteBlock(caddyfile, domain) {
    const lines = caddyfile.split('\n');
    const result = [];
    let skip = false;
    let depth = 0;
    let pendingBlank = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (!skip) {
            if (
                trimmed === `${domain} {` ||
                trimmed === `http://${domain} {` ||
                trimmed === `https://${domain} {`
            ) {
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

function replaceSiteBlock(caddyfile, oldDomain, newBlock) {
    const cleaned = removeSiteBlock(caddyfile, oldDomain);
    return `${cleaned.trimEnd()}\n\n${newBlock}\n`;
}

function isSimpleReverseProxy(route) {
    // Check if route is a simple reverse_proxy with no complex matchers
    const subroute = route.handle?.find(h => h.handler === 'subroute');
    if (!subroute) return false;
    const innerRoutes = subroute.routes ?? [];
    if (innerRoutes.length !== 1) return false;
    const handles = innerRoutes[0].handle ?? [];
    if (handles.length !== 1) return false;
    return handles[0].handler === 'reverse_proxy';
}

async function getAllServers() {
    try {
        const config = await caddyGet('/config/apps/http/servers');
        return config || {};
    } catch {
        return {};
    }
}

// GET /api/routes
router.get('/', async (req, res) => {
    try {
        const servers = await getAllServers();
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
    } catch (err) {
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

    const id = `route-${Date.now()}`;
    const route = buildReverseProxyRoute({ id, domain, upstream, stripPrefix });

    const routesPath = `/config/apps/http/servers/${PRIMARY_SERVER}/routes`;
    const existing = await caddyGet(routesPath).catch(() => null);
    if (existing === null) {
        await caddyPut(routesPath, [route]);
    } else {
        await caddyPost(routesPath, route);
    }

    const caddyfile = await readFile(CADDY_CONFIG_PATH, 'utf8');
    const block = buildCaddyfileBlock({ domain, upstream, stripPrefix });
    await writeFile(CADDY_CONFIG_PATH, `${caddyfile.trimEnd()}\n\n${block}\n`, 'utf8');

    logger.info(`Route added`, { id, domain, upstream });
    res.status(201).json({ ok: true, id, route });
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
        const oldRoute = await caddyGet(`/id/${id}`);
        oldDomain = oldRoute?.match?.[0]?.host?.[0] || null;
    } catch {
        logger.warn(`Could not fetch old route for update`, { id });
    }

    const route = buildReverseProxyRoute({ id, domain, upstream, stripPrefix });
    await caddyPatch(`/id/${id}`, route);

    if (oldDomain) {
        const caddyfile = await readFile(CADDY_CONFIG_PATH, 'utf8');
        const newBlock = buildCaddyfileBlock({ domain, upstream, stripPrefix });
        const updated = replaceSiteBlock(caddyfile, oldDomain, newBlock);
        await writeFile(CADDY_CONFIG_PATH, updated, 'utf8');
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
        const route = await caddyGet(`/id/${id}`);
        domain = route?.match?.[0]?.host?.[0] || null;
    } catch {
        logger.warn(`Could not fetch route for deletion`, { id });
    }

    await caddyDelete(`/id/${id}`);

    if (domain) {
        const caddyfile = await readFile(CADDY_CONFIG_PATH, 'utf8');
        const cleaned = removeSiteBlock(caddyfile, domain);
        await writeFile(CADDY_CONFIG_PATH, cleaned, 'utf8');
    }

    logger.info(`Route deleted`, { id, domain });
    res.json({ ok: true, id });
});

export default router;

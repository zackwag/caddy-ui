import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { caddyDelete, caddyGet, caddyPatch, caddyPut } from '../caddy.js';

const router = Router();

const PRIMARY_SERVER = process.env.CADDY_SERVER_NAME || 'srv0';
const CADDYFILE_PATH = process.env.CADDYFILE_PATH || '/etc/caddy/Caddyfile';

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

async function getAllServers() {
    try {
        const config = await caddyGet('/config/apps/http/servers');
        return config || {};
    } catch {
        return {};
    }
}

// GET /api/routes - list routes from all servers, tagged with server name
router.get('/', async (req, res) => {
    try {
        const servers = await getAllServers();
        const allRoutes = [];

        for (const [serverName, server] of Object.entries(servers)) {
            const routes = server.routes || [];
            for (const route of routes) {
                allRoutes.push({ ...route, _server: serverName });
            }
        }

        res.json(allRoutes);
    } catch (err) {
        res.json([]);
    }
});

// POST /api/routes - add a new reverse proxy route to the primary server
router.post('/', async (req, res) => {
    const { domain, upstream, stripPrefix } = req.body;
    if (!domain || !upstream) {
        return res.status(400).json({ error: 'domain and upstream are required' });
    }

    const id = `route-${Date.now()}`;
    const route = buildReverseProxyRoute({ id, domain, upstream, stripPrefix });

    const routesPath = `/config/apps/http/servers/${PRIMARY_SERVER}/routes`;
    const existing = await caddyGet(routesPath);
    const index = existing.length;
    await caddyPut(`${routesPath}/${index}`, route);

    const caddyfile = await readFile(CADDYFILE_PATH, 'utf8');
    const block = buildCaddyfileBlock({ domain, upstream, stripPrefix });
    await writeFile(CADDYFILE_PATH, `${caddyfile.trimEnd()}\n\n${block}\n`, 'utf8');

    res.status(201).json({ ok: true, id, route });
});

// PATCH /api/routes/:id - update a route by @id
router.patch('/:id', async (req, res) => {
    const { id } = req.params;
    const { domain, upstream, stripPrefix } = req.body;
    if (!domain || !upstream) {
        return res.status(400).json({ error: 'domain and upstream are required' });
    }
    const route = buildReverseProxyRoute({ id, domain, upstream, stripPrefix });
    await caddyPatch(`/id/${id}`, route);
    res.json({ ok: true, id, route });
});

// DELETE /api/routes/:id - remove a route by @id
router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    let domain = null;
    try {
        const route = await caddyGet(`/id/${id}`);
        domain = route?.match?.[0]?.host?.[0] || null;
    } catch {
        // Route may already be gone
    }

    await caddyDelete(`/id/${id}`);

    if (domain) {
        const caddyfile = await readFile(CADDYFILE_PATH, 'utf8');
        const cleaned = removeSiteBlock(caddyfile, domain);
        await writeFile(CADDYFILE_PATH, cleaned, 'utf8');
    }

    res.json({ ok: true, id });
});

export default router;

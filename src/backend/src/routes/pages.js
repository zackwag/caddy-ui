import { Router } from 'express';
import { readFile } from 'fs/promises';
import { join, basename } from 'path';

const WWW_PATH = process.env.WWW_PATH || '/etc/caddy-ui/www';

const STATUS_OVERRIDES = { 'maintenance.html': 503 };

const router = Router();

// GET /pages/:name -- serves HTML files from WWW_PATH without authentication.
// Caddy's reverse_proxy points here so maintenance (and future) pages are
// served from a single endpoint instead of inlined in the Caddyfile.
router.get('/:name', async (req, res) => {
    const name = basename(req.params.name);
    if (name !== req.params.name || !name.endsWith('.html')) {
        return res.status(404).end();
    }
    try {
        const html = await readFile(join(WWW_PATH, name), 'utf8');
        const status = STATUS_OVERRIDES[name] || 200;
        res.status(status).type('html').send(html);
    } catch {
        res.status(404).end();
    }
});

export default router;

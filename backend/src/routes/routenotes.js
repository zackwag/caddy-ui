import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { caddyGet } from '../caddy.js';
import { caddyfileTitlesEnabled, parseCaddyfileTitles } from '../caddyfileTitles.js';
import { getInstance } from '../instances.js';
import logger from '../logger.js';

const router = Router();
const ROUTE_NOTES_PATH = process.env.ROUTE_NOTES_PATH || '/etc/caddy-ui/route-notes.json';

async function readNotes() {
    try {
        const data = await readFile(ROUTE_NOTES_PATH, 'utf8');
        return JSON.parse(data);
    } catch {
        return {};
    }
}

async function writeNotes(notes) {
    await writeFile(ROUTE_NOTES_PATH, JSON.stringify(notes, null, 2), 'utf8');
}

// GET /api/route-notes
router.get('/', async (req, res) => {
    const notes = await readNotes();

    if (caddyfileTitlesEnabled()) {
        try {
            const caddyfile = await readFile(req.instance.configPath, 'utf8');
            const titles = await parseCaddyfileTitles(caddyfile);
            for (const [domain, title] of Object.entries(titles)) {
                if (title) notes[domain] = title;
            }
        } catch { /* caddyfile unreadable — return notes only */ }
    }

    res.json(notes);
});

// PUT /api/route-notes/:domain -- upsert or clear (blank note) a note
router.put('/:domain', async (req, res) => {
    const { domain } = req.params;
    const { note } = req.body;
    const notes = await readNotes();
    if (note && note.trim()) {
        notes[domain] = note.trim();
    } else {
        delete notes[domain];
    }
    await writeNotes(notes);
    res.json({ ok: true });
});

export async function cleanupOrphanedNotes(instance) {
    try {
        const inst = instance || getInstance('default');
        const notes = await readNotes();
        const domains = Object.keys(notes);
        if (domains.length === 0) return;

        const activeDomains = new Set();
        const servers = await caddyGet('/config/apps/http/servers', inst.adminUrl).catch(() => null);
        if (!servers) return;

        for (const server of Object.values(servers)) {
            for (const route of server.routes || []) {
                const hosts = route.match?.find(m => m.host)?.host || [];
                for (const h of hosts) activeDomains.add(h);
            }
        }

        let removed = 0;
        for (const domain of domains) {
            const domainParts = domain.split(', ');
            const stillActive = domainParts.some(d => activeDomains.has(d));
            if (!stillActive) {
                delete notes[domain];
                removed++;
            }
        }

        if (removed > 0) {
            await writeNotes(notes);
            logger.info(`Cleaned up orphaned route notes`, { removed });
        }
    } catch (e) {
        logger.warn(`Route notes cleanup failed`, { error: e.message });
    }
}

export default router;

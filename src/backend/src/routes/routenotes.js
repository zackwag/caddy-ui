import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { caddyGet } from '../caddy.js';
import { caddyfileTitlesEnabled, parseCaddyfileTitles } from '../caddyfileTitles.js';
import { readContainerFile } from '../containerFs.js';
import { getInstances } from '../instances.js';
import logger from '../logger.js';
import { AppError, asAppError } from '../AppError.js';
import { sendAppError } from '../errorReporting.js';

const router = Router();
const ROUTE_NOTES_PATH = process.env.ROUTE_NOTES_PATH || '/etc/caddy-ui/route-notes.json';

// A missing file means no notes yet. Any other failure throws, so an
// unreadable or corrupt file is never treated as empty and then overwritten.
async function readNotes() {
    let data;
    try {
        data = await readFile(ROUTE_NOTES_PATH, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return {};
        throw new AppError('ROUTE_NOTES_READ_FAILED', { cause: err, context: { path: ROUTE_NOTES_PATH } });
    }
    let notes;
    try {
        notes = JSON.parse(data);
    } catch (err) {
        throw new AppError('ROUTE_NOTES_READ_FAILED', { cause: err, context: { path: ROUTE_NOTES_PATH } });
    }
    if (!notes || typeof notes !== 'object' || Array.isArray(notes)) {
        throw new AppError('ROUTE_NOTES_READ_FAILED', { context: { path: ROUTE_NOTES_PATH } });
    }
    return notes;
}

async function writeNotes(notes) {
    await writeFile(ROUTE_NOTES_PATH, JSON.stringify(notes, null, 2), 'utf8');
}

// GET /api/route-notes
router.get('/', async (req, res) => {
    let notes;
    try {
        notes = await readNotes();
    } catch (err) {
        return sendAppError(res, asAppError(err, 'ROUTE_NOTES_READ_FAILED'));
    }

    if (caddyfileTitlesEnabled()) {
        try {
            const caddyfile = await readContainerFile(req.instance.containerName, req.instance.configPath);
            const titles = await parseCaddyfileTitles(caddyfile, req.instance.containerName);
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
    let notes;
    try {
        notes = await readNotes();
    } catch (err) {
        return sendAppError(res, asAppError(err, 'ROUTE_NOTES_READ_FAILED'));
    }
    if (note && note.trim()) {
        notes[domain] = note.trim();
    } else {
        delete notes[domain];
    }
    await writeNotes(notes);
    res.json({ ok: true });
});

export async function cleanupOrphanedNotes() {
    try {
        const notes = await readNotes();
        const domains = Object.keys(notes);
        if (domains.length === 0) return;

        // Only prune against a complete view: an instance whose config can't be
        // read would otherwise have all of its notes treated as orphaned.
        const activeDomains = new Set();
        const unreadable = [];
        await Promise.all(getInstances().map(async inst => {
            let servers;
            try {
                servers = await caddyGet('/config/apps/http/servers', inst.adminUrl);
            } catch {
                unreadable.push(inst.id);
                return;
            }
            if (!servers) return;
            for (const server of Object.values(servers)) {
                for (const route of server.routes || []) {
                    const hosts = route.match?.find(m => m.host)?.host || [];
                    for (const h of hosts) activeDomains.add(h);
                }
            }
        }));

        if (unreadable.length) {
            logger.warn('Skipped route notes cleanup: Caddy config unavailable', { instances: unreadable });
            return;
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

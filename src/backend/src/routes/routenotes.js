import { Router } from 'express';
import { caddyfileTitlesEnabled, parseCaddyfileTitles } from '../caddyfileTitles.js';
import { readContainerFile } from '../containerFs.js';
import { getInstances } from '../instances.js';
import logger from '../logger.js';
import { getServers } from '../observations.js';
import { asAppError } from '../AppError.js';
import { sendAppError } from '../errorReporting.js';
import { claimUnassignedNotes, getInstanceNotes, hasUnassignedNotes, pruneOrphanedNotes, setInstanceNote } from '../routeNotes.js';

const router = Router();

// Hosts an instance currently routes, from its live config; null when the
// config can't be read.
export async function servedHosts(inst) {
    let servers;
    try {
        servers = await getServers(inst.adminUrl);
    } catch {
        return null;
    }
    const hosts = new Set();
    for (const server of Object.values(servers || {})) {
        for (const route of server.routes || []) {
            for (const host of route.match?.find(m => m.host)?.host || []) hosts.add(host);
        }
    }
    return hosts;
}

// GET /api/route-notes -- the selected instance's notes
router.get('/', async (req, res) => {
    let notes;
    try {
        if (await hasUnassignedNotes()) await claimUnassignedNotes(getInstances(), servedHosts);
        notes = await getInstanceNotes(req.instance.id);
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

// PUT /api/route-notes/:domain -- upsert or clear (blank note) the selected instance's note
router.put('/:domain', async (req, res) => {
    const { domain } = req.params;
    const { note } = req.body;
    try {
        await setInstanceNote(req.instance.id, domain, typeof note === 'string' ? note.trim() : '');
    } catch (err) {
        return sendAppError(res, asAppError(err, 'ROUTE_NOTES_SAVE_FAILED'));
    }
    res.json({ ok: true });
});

// Runs once at startup: assigns notes saved before notes were per instance,
// then drops notes for domains their instance no longer serves.
export async function cleanupOrphanedNotes() {
    try {
        const instances = getInstances();
        await claimUnassignedNotes(instances, servedHosts);
        await pruneOrphanedNotes(instances, servedHosts);
    } catch (e) {
        logger.warn(`Route notes cleanup failed`, { error: e.message });
    }
}

export default router;

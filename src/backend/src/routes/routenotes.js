import { Router } from 'express';
import { asAppError } from '../AppError.js';
import { audited } from '../auditLog.js';
import { caddyfileTitlesEnabled, parseCaddyfileTitles } from '../caddyfileTitles.js';
import { readContainerFile } from '../containerFs.js';
import { claimNotes } from '../noteOwners.js';
import { getInstanceNotes, setInstanceNote } from '../routeNotes.js';

const router = Router();

// GET /api/route-notes -- the selected instance's notes
router.get('/', async (req, res) => {
    let notes;
    try {
        await claimNotes();
        notes = await getInstanceNotes(req.instance.id);
    } catch (err) {
        throw asAppError(err, 'ROUTE_NOTES_READ_FAILED');
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
    const title = typeof note === 'string' ? note.trim() : '';
    try {
        await audited(req, { action: 'routeTitle.set', instanceId: req.instance.id, resource: domain, details: { title } },
            () => setInstanceNote(req.instance.id, domain, title));
    } catch (err) {
        throw asAppError(err, 'ROUTE_NOTES_SAVE_FAILED');
    }
    res.json({ ok: true });
});

export default router;

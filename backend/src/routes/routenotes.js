import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';

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
    res.json(notes);
});

// PUT /api/route-notes/:domain
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

// DELETE /api/route-notes/:domain
router.delete('/:domain', async (req, res) => {
    const { domain } = req.params;
    const notes = await readNotes();
    delete notes[domain];
    await writeNotes(notes);
    res.json({ ok: true });
});

export default router;

import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';

const router = Router();
const NAMES_PATH = process.env.SERVER_NAMES_PATH || '/etc/caddy-ui/server-names.json';

async function readNames() {
    try {
        const content = await readFile(NAMES_PATH, 'utf8');
        return JSON.parse(content);
    } catch {
        return {};
    }
}

async function writeNames(names) {
    await writeFile(NAMES_PATH, JSON.stringify(names, null, 2), 'utf8');
}

router.get('/', async (req, res) => {
    const names = await readNames();
    res.json(names);
});

router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'name is required' });
    }
    const names = await readNames();
    names[id] = name.trim();
    await writeNames(names);
    res.json({ ok: true, id, name: names[id] });
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const names = await readNames();
    delete names[id];
    await writeNames(names);
    res.json({ ok: true, id });
});

export default router;

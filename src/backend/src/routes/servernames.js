import { Router } from 'express';
import { getAllServerNames, getServerNames, removeServerName, setServerName } from '../serverNames.js';

const router = Router();

// GET /api/server-names -- labels for the selected instance
router.get('/', (req, res) => {
    res.json(getServerNames(req.instance.id));
});

// GET /api/server-names/all -- labels for every instance, keyed by instance ID
router.get('/all', (req, res) => {
    res.json(getAllServerNames());
});

router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'name is required' });
    }
    await setServerName(req.instance.id, id, name.trim());
    res.json({ ok: true, id, name: name.trim() });
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    await removeServerName(req.instance.id, id);
    res.json({ ok: true, id });
});

export default router;

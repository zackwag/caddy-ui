import { Router } from 'express';
import { AppError } from '../AppError.js';
import { audited } from '../auditLog.js';
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
        throw new AppError('VALIDATION_FAILED', { context: { field: 'name' } });
    }
    const label = name.trim();
    await audited(req, { action: 'serverName.set', instanceId: req.instance.id, resource: id, details: { name: label } },
        () => setServerName(req.instance.id, id, label));
    res.json({ ok: true, id, name: label });
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    await audited(req, { action: 'serverName.remove', instanceId: req.instance.id, resource: id },
        () => removeServerName(req.instance.id, id));
    res.json({ ok: true, id });
});

export default router;

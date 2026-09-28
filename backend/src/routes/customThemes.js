import { Router } from 'express';
import { getCustomThemes } from '../customThemes.js';

const router = Router();

// GET /api/custom-themes -- themes found under THEMES_PATH at startup.
// Read-only: themes are managed as files on disk, not through the API.
router.get('/', (req, res) => {
    res.json(getCustomThemes());
});

export default router;

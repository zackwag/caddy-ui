import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { authEnabled } from '../middleware/auth.js';

const router = Router();

const CADDY_UI_USER = process.env.CADDY_UI_USER;
const CADDY_UI_PASSWORD = process.env.CADDY_UI_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;

// POST /api/auth/login
router.post('/login', (req, res) => {
    if (!authEnabled) {
        return res.json({ ok: true, token: null, authEnabled: false });
    }

    const { username, password } = req.body;
    if (username !== CADDY_UI_USER || password !== CADDY_UI_PASSWORD) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ ok: true, token, authEnabled: true });
});

// GET /api/auth/status -- lets the frontend check if auth is enabled
router.get('/status', (req, res) => {
    res.json({ authEnabled });
});

export default router;

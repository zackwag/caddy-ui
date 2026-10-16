import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { authEnabled, publicMetrics } from '../middleware/auth.js';

const router = Router();

const CADDY_UI_USER = process.env.CADDY_UI_USER;
const CADDY_UI_PASSWORD = process.env.CADDY_UI_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;

router.post('/sessions', (req, res) => {
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

router.get('/status', (req, res) => {
    res.json({ authEnabled, publicMetrics });
});

export default router;

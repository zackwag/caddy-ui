import jwt from 'jsonwebtoken';

const CADDY_UI_USER = process.env.CADDY_UI_USER;
const CADDY_UI_PASSWORD = process.env.CADDY_UI_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;

export const authEnabled = !!(CADDY_UI_USER && CADDY_UI_PASSWORD && JWT_SECRET);

export function authMiddleware(req, res, next) {
    if (!authEnabled) return next();

    // Support token in query param for SSE and file downloads
    const queryToken = req.query.token;
    const header = req.headers['authorization'];
    const token = queryToken || (header?.startsWith('Bearer ') ? header.slice(7) : null);

    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

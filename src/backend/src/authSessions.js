import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'caddy_ui_session';
const SESSION_MS = 24 * 60 * 60 * 1000;
const LIMITED_MS = 10 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest('hex');

// Deliberately process-local: a backend restart signs every browser out.
export function createAuthSessions({ secure = false, now = Date.now, limit = 2048 } = {}) {
    const sessions = new Map();

    function readSession(req) {
        const cookies = (req.headers.cookie || '').split(';').map(value => value.trim());
        const values = cookies.filter(value => value.startsWith(COOKIE + '=')).map(value => value.slice(COOKIE.length + 1));
        if (values.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(values[0])) return null;
        const id = digest(values[0]);
        const session = sessions.get(id);
        if (!session) return null;
        if (session.expires <= now()) { sessions.delete(id); return null; }
        return session;
    }

    function cookie(res, value, lifetime) {
        res.cookie(COOKIE, value, { httpOnly: true, sameSite: 'strict', secure, path: '/api', maxAge: lifetime });
    }

    function revokeSession(req, res) {
        const session = readSession(req);
        if (session) sessions.delete(session.id);
        cookie(res, '', 0);
    }

    function createSession(req, res, permission = 'anonymous') {
        for (const [id, value] of sessions) if (value.expires <= now()) sessions.delete(id);
        if (sessions.size >= limit) throw new Error('Session capacity reached. Try again later.');
        revokeSession(req, res);
        const token = randomBytes(32).toString('base64url');
        const id = digest(token);
        const lifetime = permission === 'management' ? SESSION_MS : LIMITED_MS;
        const session = { id, permission, csrf: randomBytes(32).toString('base64url'), expires: now() + lifetime };
        sessions.set(id, session);
        cookie(res, token, lifetime);
        return session;
    }

    return {
        readSession, createSession, revokeSession,
        revokeAllSessions() { sessions.clear(); },
        issueCsrfToken(req, res) {
            return (readSession(req) || createSession(req, res)).csrf;
        },
        verifyCsrfToken(req) {
            const session = readSession(req);
            const token = req.headers['x-csrf-token'];
            if (!session || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
            return timingSafeEqual(Buffer.from(token), Buffer.from(session.csrf));
        },
    };
}

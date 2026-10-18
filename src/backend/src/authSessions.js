import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'caddy_ui_session';
const SESSION_MS = 24 * 60 * 60 * 1000;
const LIMITED_MS = 10 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest('hex');

// Deliberately process-local: a backend restart signs every browser out.
// Anyone can create an anonymous pre-login context by fetching a CSRF token,
// so those have their own cap and evict the oldest instead of refusing. Only
// sessions that required credentials count toward `limit`, so anonymous
// requests can never lock the administrator out.
export function createAuthSessions({ secure = false, now = Date.now, limit = 2048, anonymousLimit = 1024 } = {}) {
    const sessions = new Map();

    function remove(id) {
        const session = sessions.get(id);
        sessions.delete(id);
        for (const close of session?.connections || []) close();
    }

    function readSession(req) {
        const cookies = (req.headers.cookie || '').split(';').map(value => value.trim());
        const values = cookies.filter(value => value.startsWith(COOKIE + '=')).map(value => value.slice(COOKIE.length + 1));
        if (values.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(values[0])) return null;
        const id = digest(values[0]);
        const session = sessions.get(id);
        if (!session) return null;
        if (session.expires <= now()) { remove(id); return null; }
        return session;
    }

    function cookie(res, value, lifetime) {
        res.cookie(COOKIE, value, { httpOnly: true, sameSite: 'strict', secure, path: '/api', maxAge: lifetime });
    }

    function revokeSession(req, res) {
        const session = readSession(req);
        if (session) remove(session.id);
        cookie(res, '', 0);
    }

    function createSession(req, res, permission = 'anonymous') {
        for (const [id, value] of sessions) if (value.expires <= now()) remove(id);
        if (permission === 'anonymous') {
            // Map order is creation order, so the first anonymous entry is the oldest
            const anonymous = [...sessions.values()].filter(value => value.permission === 'anonymous');
            if (anonymous.length >= anonymousLimit) remove(anonymous[0].id);
        } else {
            // Replacing a signed-in session doesn't add one, so only that may exceed the limit
            const authenticated = [...sessions.values()].filter(value => value.permission !== 'anonymous').length;
            const replacing = readSession(req);
            if (authenticated >= limit && !(replacing && replacing.permission !== 'anonymous')) {
                throw new Error('Session capacity reached. Try again later.');
            }
        }
        revokeSession(req, res);
        const token = randomBytes(32).toString('base64url');
        const id = digest(token);
        const lifetime = permission === 'management' ? SESSION_MS : LIMITED_MS;
        const session = { id, permission, csrf: randomBytes(32).toString('base64url'), expires: now() + lifetime, connections: new Set() };
        sessions.set(id, session);
        cookie(res, token, lifetime);
        return session;
    }

    return {
        readSession, createSession, revokeSession,
        revokeAllSessions() { for (const id of sessions.keys()) remove(id); },
        watchSession(session, res) {
            // End long-lived log streams on logout, recovery and expiration too.
            const close = () => res.end();
            session.connections.add(close);
            const timer = setTimeout(close, Math.max(0, session.expires - now()));
            timer.unref();
            const cleanup = () => { clearTimeout(timer); session.connections.delete(close); };
            res.once('close', cleanup);
            res.once('finish', cleanup);
        },
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

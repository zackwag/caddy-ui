import express from 'express';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthSessions } from '../src/authSessions.js';
import { createCsrfMiddleware } from '../src/middleware/csrf.js';

const servers = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))); });

async function fixture(options) {
    const sessions = createAuthSessions(options);
    const app = express();
    let writes = 0;
    app.get('/csrf', (req, res) => res.json({ csrfToken: sessions.issueCsrfToken(req, res) }));
    app.post('/write', createCsrfMiddleware(sessions), (_req, res) => { writes++; res.json({ ok: true }); });
    app.post('/login', createCsrfMiddleware(sessions), (req, res) => {
        sessions.createSession(req, res, 'management');
        res.json({ ok: true });
    });
    app.get('/protected', (req, res) => res.status(sessions.readSession(req)?.permission === 'management' ? 200 : 401).end());
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    return { sessions, url: `http://127.0.0.1:${server.address().port}`, writes: () => writes };
}

async function context(url) {
    const response = await fetch(url + '/csrf');
    const { csrfToken } = await response.json();
    const cookie = response.headers.getSetCookie().at(-1).split(';')[0];
    return { cookie, 'x-csrf-token': csrfToken };
}

describe('browser session boundary', () => {
    it('can rotate an existing login context even when the session registry is full', async () => {
        const { url } = await fixture({ limit: 1 });
        const headers = await context(url);
        expect((await fetch(url + '/login', { method: 'POST', headers })).status).toBe(200);
    });
    it("doesn't let anonymous CSRF contexts lock the administrator out", async () => {
        const { url, sessions } = await fixture({ limit: 4, anonymousLimit: 3 });
        const first = await context(url);
        for (let i = 0; i < 10; i++) await fetch(url + '/csrf');
        // The oldest anonymous contexts were evicted rather than new ones refused
        expect(sessions.readSession({ headers: { cookie: first.cookie } })).toBeNull();
        const headers = await context(url);
        expect((await fetch(url + '/login', { method: 'POST', headers })).status).toBe(200);
    });

    it('still refuses new sign-ins once authenticated sessions reach the limit', async () => {
        const { url } = await fixture({ limit: 1 });
        expect((await fetch(url + '/login', { method: 'POST', headers: await context(url) })).status).toBe(200);
        const response = await fetch(url + '/login', { method: 'POST', headers: await context(url) });
        expect(response.status).toBe(500);
    });

    it('preserves and rotates a signed-in session at capacity while anonymous contexts are evicted', async () => {
        const { url } = await fixture({ limit: 1, anonymousLimit: 2 });
        const login = await fetch(url + '/login', { method: 'POST', headers: await context(url) });
        expect(login.status).toBe(200);
        const cookie = login.headers.getSetCookie().at(-1).split(';')[0];
        for (let i = 0; i < 5; i++) expect((await fetch(url + '/csrf')).status).toBe(200);
        expect((await fetch(url + '/protected', { headers: { cookie } })).status).toBe(200);
        const response = await fetch(url + '/csrf', { headers: { cookie } });
        const { csrfToken } = await response.json();
        const rotated = await fetch(url + '/login', { method: 'POST', headers: { cookie, 'x-csrf-token': csrfToken } });
        expect(rotated.status).toBe(200);
        const replacement = rotated.headers.getSetCookie().at(-1).split(';')[0];
        expect((await fetch(url + '/protected', { headers: { cookie } })).status).toBe(401);
        expect((await fetch(url + '/protected', { headers: { cookie: replacement } })).status).toBe(200);
    });

    it('binds CSRF tokens to a cookie context and rejects missing, mixed and duplicate cookies', async () => {
        const f = await fixture();
        const first = await context(f.url);
        const second = await context(f.url);
        for (const headers of [{}, { cookie: first.cookie }, { 'x-csrf-token': first['x-csrf-token'] },
            { ...first, cookie: second.cookie }, { ...first, cookie: first.cookie + '; ' + second.cookie }]) {
            expect((await fetch(f.url + '/write', { method: 'POST', headers })).status).toBe(403);
        }
        expect(f.writes()).toBe(0);
        expect((await fetch(f.url + '/write', { method: 'POST', headers: first })).status).toBe(200);
        expect(f.writes()).toBe(1);
    });

    it.each([false, true])('sets host-only, HttpOnly, SameSite cookies with Secure=%s', async secure => {
        const { url } = await fixture({ secure });
        const response = await fetch(url + '/csrf');
        const cookie = response.headers.getSetCookie().at(-1);
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie).toContain('Path=/api');
        expect(cookie.includes('; Secure')).toBe(secure);
        expect(cookie).not.toContain('Domain=');
        expect(response.headers.getSetCookie().at(-1)).not.toContain((await response.json()).csrfToken);
    });

    it('rotates session IDs at login, expires sessions and revokes them globally', async () => {
        let now = 0;
        const { url, sessions } = await fixture({ now: () => now });
        const headers = await context(url);
        const response = await fetch(url + '/login', { method: 'POST', headers });
        const cookie = response.headers.getSetCookie().at(-1).split(';')[0];
        expect(cookie).not.toBe(headers.cookie);
        expect((await fetch(url + '/protected', { headers: { cookie } })).status).toBe(200);
        expect((await fetch(url + '/write', { method: 'POST', headers })).status).toBe(403);
        now = 24 * 60 * 60 * 1000;
        expect((await fetch(url + '/protected', { headers: { cookie } })).status).toBe(401);
        const next = await context(url);
        sessions.revokeAllSessions();
        expect((await fetch(url + '/write', { method: 'POST', headers: next })).status).toBe(403);
    });
});

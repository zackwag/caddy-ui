import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diagnosticMiddleware } from '../src/errorReporting.js';
import { createCrossSiteMiddleware, crossSiteRejectionCode, isCrossSiteWrite, misnamedExternalUrlVariables } from '../src/middleware/crossSite.js';

describe('isCrossSiteWrite', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects cross-site and same-site %s', method => {
        expect(isCrossSiteWrite(method, { 'sec-fetch-site': 'cross-site' })).toBe(true);
        expect(isCrossSiteWrite(method, { 'sec-fetch-site': 'same-site' })).toBe(true);
    });

    it('allows same-origin Fetch Metadata and requests without browser-origin headers', () => {
        expect(isCrossSiteWrite('POST', { 'sec-fetch-site': 'same-origin' })).toBe(false);
        expect(isCrossSiteWrite('POST', { 'sec-fetch-site': 'none' })).toBe(false);
        expect(isCrossSiteWrite('POST', {})).toBe(false);
    });

    it.each([
        [{ origin: 'https://attacker.example' }, true],
        [{ origin: 'https://ui.example:8443' }, false],
        [{ origin: 'http://ui.example:8443' }, true],
        [{ origin: 'https://ui.example' }, true],
        [{ origin: 'https://ui.example:8443.attacker.test' }, true],
        [{ origin: 'null', referer: 'https://ui.example:8443/' }, true],
        [{ origin: 'https://ui.example:8443', referer: 'https://attacker.example/' }, false],
        [{ origin: 'https://attacker.example', referer: 'https://ui.example:8443/' }, true],
        [{ origin: 'https://ui.example:8443/' }, true],
        [{ referer: 'https://ui.example:8443/settings?tab=auth' }, false],
        [{ referer: 'https://attacker.example/' }, true],
        [{ referer: 'not-a-url' }, true],
        [{ referer: 'data:text/html,hello' }, true],
        [{ origin: ['https://ui.example:8443', 'https://attacker.example'] }, true],
        [{ referer: ['https://ui.example:8443/', 'https://attacker.example/'] }, true],
        [{ origin: 'https://ui.example:8443', 'sec-fetch-site': 'cross-site' }, true],
        [{ origin: 'https://attacker.example', 'sec-fetch-site': 'same-origin' }, true],
        [{ origin: 'https://attacker.example', host: 'attacker.example',
            'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https' }, true],
    ])('validates browser origin headers %j (blocked=%s)', (headers, blocked) => {
        expect(isCrossSiteWrite('POST', headers, new Set(['https://ui.example:8443']))).toBe(blocked);
    });

    it('rejects a Referer disguising an attacker host with the UI origin as userinfo', () => {
        const expected = new URL('https://ui.example:8443');
        const referer = new URL('https://attacker.example/');
        // Build the spoofing fixture at runtime instead of embedding userinfo
        // that secret scanners can mistake for a real credential-bearing URL.
        referer.username = expected.hostname;
        referer.password = expected.port;
        expect(isCrossSiteWrite('POST', { referer: referer.href }, new Set([expected.origin]))).toBe(true);
    });

    it('requires configuration for browser-origin writes without trustworthy Fetch Metadata', () => {
        expect(isCrossSiteWrite('POST', { origin: 'http://ui.lan:9877' })).toBe(true);
        expect(isCrossSiteWrite('POST', { origin: 'null', 'sec-fetch-site': 'same-origin' })).toBe(true);
        expect(isCrossSiteWrite('POST', { referer: 'http://ui.lan:9877/' })).toBe(true);
        expect(isCrossSiteWrite('POST', { origin: 'https://ui.example', 'sec-fetch-site': 'same-origin' })).toBe(false);
        expect(isCrossSiteWrite('POST', {})).toBe(false);
    });

    it.each(['GET', 'HEAD', 'OPTIONS'])('allows cross-site %s', method => {
        expect(isCrossSiteWrite(method, { 'sec-fetch-site': 'cross-site' })).toBe(false);
    });
});

describe('crossSiteMiddleware', () => {
    let server;
    let baseUrl;
    let writes = 0;

    beforeAll(async () => {
        const app = express();
        app.use(diagnosticMiddleware);
        app.use('/api', createCrossSiteMiddleware('https://ui.example:8443'));
        app.post('/api/caddyfile/reloads', (req, res) => {
            writes += 1;
            res.json({ ok: true });
        });
        app.get('/api/caddyfile', (req, res) => res.json({ content: 'example.com' }));
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(() => new Promise(resolve => server.close(resolve)));

    it('blocks a forged bodiless POST before it reaches the route', async () => {
        writes = 0;
        const response = await fetch(`${baseUrl}/api/caddyfile/reloads`, {
            method: 'POST',
            headers: { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://attacker.example' },
        });
        expect(response.status).toBe(403);
        expect((await response.json()).code).toBe('FORBIDDEN');
        expect(writes).toBe(0);
    });

    it('lets the UI and scripts write', async () => {
        writes = 0;
        await fetch(`${baseUrl}/api/caddyfile/reloads`, { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin' } });
        await fetch(`${baseUrl}/api/caddyfile/reloads`, { method: 'POST' });
        expect(writes).toBe(2);
    });

    it.each([
        [{ Origin: 'https://attacker.example' }, 403, 'EXTERNAL_URL_MISMATCH'],
        [{ Origin: 'null', Referer: 'https://ui.example:8443/' }, 403, 'FORBIDDEN'],
        [{ Referer: 'https://attacker.example/' }, 403, 'EXTERNAL_URL_MISMATCH'],
        [{ Referer: 'broken' }, 403, 'EXTERNAL_URL_MISMATCH'],
        [{ Origin: 'https://ui.example:8443', 'X-Forwarded-Host': 'backend:3001', 'X-Forwarded-Proto': 'http' }, 200],
        [{ Referer: 'https://ui.example:8443/settings' }, 200],
        [{ Origin: 'http://ui.example:8443' }, 403, 'EXTERNAL_URL_MISMATCH'],
        [{ Origin: 'https://ui.example' }, 403, 'EXTERNAL_URL_MISMATCH'],
        [{ Origin: 'https://ui.example', 'Sec-Fetch-Site': 'same-origin' }, 403, 'EXTERNAL_URL_MISMATCH'],
        [{ Origin: 'https://ui.example:8443', 'Sec-Fetch-Site': 'same-site' }, 403, 'FORBIDDEN'],
    ])('checks origin before reaching the route (%j)', async (headers, status, code) => {
        writes = 0;
        const response = await fetch(`${baseUrl}/api/caddyfile/reloads`, { method: 'POST', headers });
        expect(response.status).toBe(status);
        expect(writes).toBe(status === 200 ? 1 : 0);
        if (status === 403) {
            const body = await response.json();
            expect(body.code).toBe(code);
            expect(body.requestId).toBe(response.headers.get('x-request-id'));
        }
    });

    it('serves cross-site reads without CORS headers', async () => {
        const response = await fetch(`${baseUrl}/api/caddyfile`, {
            headers: { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://attacker.example' },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });
});

describe('crossSiteRejectionCode', () => {
    it.each([
        [{ 'sec-fetch-site': 'cross-site', origin: 'https://attacker.example' }, false, 'FORBIDDEN'],
        [{ 'sec-fetch-site': 'same-site', origin: 'https://ui.example' }, true, 'FORBIDDEN'],
        [{ origin: 'null' }, false, 'FORBIDDEN'],
        [{ origin: 'http://192.168.4.87:9877' }, false, 'EXTERNAL_URL_REQUIRED'],
        [{ referer: 'http://192.168.4.87:9877/' }, false, 'EXTERNAL_URL_REQUIRED'],
        [{ origin: 'http://192.168.4.87:9877' }, true, 'EXTERNAL_URL_MISMATCH'],
        [{ origin: 'https://caddy.internal', 'sec-fetch-site': 'same-origin' }, true, 'EXTERNAL_URL_MISMATCH'],
    ])('classifies %j (configured=%s) as %s', (headers, configured, code) => {
        expect(crossSiteRejectionCode(headers, configured)).toBe(code);
    });

    it('tells an unconfigured backend apart from an unlisted origin', async () => {
        const response = {};
        const res = { locals: {}, status: status => { response.status = status; return res; }, json: body => { response.body = body; return res; } };
        createCrossSiteMiddleware(undefined)({ method: 'POST', headers: { origin: 'http://192.168.4.87:9877' } }, res, () => {});
        expect(response).toEqual({ status: 403, body: expect.objectContaining({ code: 'EXTERNAL_URL_REQUIRED' }) });
    });
});

describe('misnamedExternalUrlVariables', () => {
    it.each([
        [{ CADDY_EXTERNAL_URL: 'http://192.168.4.87' }, ['CADDY_EXTERNAL_URL']],
        [{ CADDY_UI_EXTERNAL_URLS: 'https://caddy.internal' }, ['CADDY_UI_EXTERNAL_URLS']],
        [{ CADDY_EXTERNAL_URL: 'http://a', CADDY_UI_EXTERNAL_URLS: 'http://b' }, ['CADDY_EXTERNAL_URL', 'CADDY_UI_EXTERNAL_URLS']],
        [{ CADDY_EXTERNAL_URL: 'http://a', CADDY_UI_EXTERNAL_URL: 'http://b' }, []],
        [{ CADDY_EXTERNAL_URL: '' }, []],
        [{}, []],
    ])('reports ignored variables in %j', (env, expected) => {
        expect(misnamedExternalUrlVariables(env)).toEqual(expected);
    });
});

describe('external origin configuration', () => {
    it.each(['not-a-url', '/relative', 'ftp://ui.example', 'file:///tmp/ui'])('rejects invalid setting %s at startup', value => {
        expect(() => createCrossSiteMiddleware(value)).toThrow('CADDY_UI_EXTERNAL_URL');
    });

    it.each(['username', 'password', 'both'])('rejects %s userinfo in the configured URL', fields => {
        const configured = new URL('https://ui.example');
        if (fields !== 'password') configured.username = randomUUID();
        if (fields !== 'username') configured.password = randomUUID();
        expect(() => createCrossSiteMiddleware(configured.href)).toThrow('CADDY_UI_EXTERNAL_URL');
    });

    it.each([undefined, ''])('allows an unset setting (%s)', value => {
        expect(() => createCrossSiteMiddleware(value)).not.toThrow();
    });

    it('normalizes the configured origin and ignores its path', () => {
        const middleware = createCrossSiteMiddleware('HTTPS://UI.EXAMPLE:443/console/');
        let passed = false;
        middleware({ method: 'POST', headers: { origin: 'https://ui.example' } }, {}, () => { passed = true; });
        expect(passed).toBe(true);
    });

    it('accepts comma-separated origins and allows any of them', () => {
        const multi = 'https://caddy.internal, http://192.168.4.87:9877';
        expect(() => createCrossSiteMiddleware(multi)).not.toThrow();
        expect(isCrossSiteWrite('POST', { origin: 'https://caddy.internal' }, new Set(['https://caddy.internal', 'http://192.168.4.87:9877']))).toBe(false);
        expect(isCrossSiteWrite('POST', { origin: 'http://192.168.4.87:9877' }, new Set(['https://caddy.internal', 'http://192.168.4.87:9877']))).toBe(false);
        expect(isCrossSiteWrite('POST', { origin: 'https://attacker.example' }, new Set(['https://caddy.internal', 'http://192.168.4.87:9877']))).toBe(true);
    });

    it('rejects the whole setting when any entry is invalid', () => {
        expect(() => createCrossSiteMiddleware('https://ok.example,not-a-url')).toThrow('CADDY_UI_EXTERNAL_URL');
        expect(() => createCrossSiteMiddleware('https://ok.example,ftp://bad.example')).toThrow('CADDY_UI_EXTERNAL_URL');
    });

    it('ignores empty entries from trailing or doubled commas', () => {
        expect(() => createCrossSiteMiddleware('https://ui.example,,https://alt.example,')).not.toThrow();
    });
});

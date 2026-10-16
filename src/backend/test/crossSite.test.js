import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diagnosticMiddleware } from '../src/errorReporting.js';
import { createCrossSiteMiddleware, isCrossSiteWrite } from '../src/middleware/crossSite.js';

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
        expect(isCrossSiteWrite('POST', headers, 'https://ui.example:8443')).toBe(blocked);
    });

    it('rejects a Referer disguising an attacker host with the UI origin as userinfo', () => {
        const expected = new URL('https://ui.example:8443');
        const referer = new URL('https://attacker.example/');
        // Build the spoofing fixture at runtime instead of embedding userinfo
        // that secret scanners can mistake for a real credential-bearing URL.
        referer.username = expected.hostname;
        referer.password = expected.port;
        expect(isCrossSiteWrite('POST', { referer: referer.href }, expected.origin)).toBe(true);
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
        [{ Origin: 'https://attacker.example' }, 403],
        [{ Origin: 'null', Referer: 'https://ui.example:8443/' }, 403],
        [{ Referer: 'https://attacker.example/' }, 403],
        [{ Referer: 'broken' }, 403],
        [{ Origin: 'https://ui.example:8443', 'X-Forwarded-Host': 'backend:3001', 'X-Forwarded-Proto': 'http' }, 200],
        [{ Referer: 'https://ui.example:8443/settings' }, 200],
        [{ Origin: 'http://ui.example:8443' }, 403],
        [{ Origin: 'https://ui.example' }, 403],
    ])('checks origin before reaching the route (%j)', async (headers, status) => {
        writes = 0;
        const response = await fetch(`${baseUrl}/api/caddyfile/reloads`, { method: 'POST', headers });
        expect(response.status).toBe(status);
        expect(writes).toBe(status === 200 ? 1 : 0);
        if (status === 403) {
            const body = await response.json();
            expect(body.code).toBe('FORBIDDEN');
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
});

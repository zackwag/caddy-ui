import { once } from 'node:events';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diagnosticMiddleware } from '../src/errorReporting.js';
import { crossSiteMiddleware, isCrossSiteWrite } from '../src/middleware/crossSite.js';

describe('isCrossSiteWrite', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects cross-site and same-site %s', method => {
        expect(isCrossSiteWrite(method, { 'sec-fetch-site': 'cross-site' })).toBe(true);
        expect(isCrossSiteWrite(method, { 'sec-fetch-site': 'same-site' })).toBe(true);
    });

    it('allows writes from the UI origin and from clients that are not browsers', () => {
        expect(isCrossSiteWrite('POST', { 'sec-fetch-site': 'same-origin' })).toBe(false);
        expect(isCrossSiteWrite('POST', { 'sec-fetch-site': 'none' })).toBe(false);
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
        app.use('/api', crossSiteMiddleware);
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

    it('serves cross-site reads without CORS headers', async () => {
        const response = await fetch(`${baseUrl}/api/caddyfile`, {
            headers: { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://attacker.example' },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });
});

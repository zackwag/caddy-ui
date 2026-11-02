import { once } from 'node:events';
import express from 'express';
import { diagnosticMiddleware } from '../../src/errorReporting.js';
import { createCrossSiteMiddleware } from '../../src/middleware/crossSite.js';

// Kept with the backend so Express remains a backend-owned dependency. The
// browser tests exercise the production middleware, not a rewritten validator.
export async function createCrossSiteFixture(configured = true) {
    const records = [];
    let writes = 0;
    let policy;
    const app = express();
    app.use(diagnosticMiddleware);
    app.use('/api', (req, res, next) => {
        const record = {
            method: req.method, origin: req.headers.origin,
            site: req.headers['sec-fetch-site'],
        };
        records.push(record);
        res.on('finish', () => { record.status = res.statusCode; });
        policy(req, res, next);
    });
    app.get('/', (req, res) => res.type('html').send('<!doctype html><title>UI origin fixture</title>'));
    app.get('/api/read', (req, res) => res.json({ fixture: true }));
    app.post('/api/write', (req, res) => {
        writes++;
        req.resume();
        res.json({ ok: true });
    });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    // Chromium treats this HTTP URL as untrustworthy, despite its physical
    // loopback connection. This reproduces missing Fetch Metadata without LAN,
    // DNS overrides, request interception or modified browser security flags.
    const origin = new URL(`http://[::ffff:127.0.0.1]:${port}`).origin;
    policy = createCrossSiteMiddleware(configured ? origin : undefined);
    return {
        origin, directOrigin: `http://127.0.0.1:${port}`, records,
        get writes() { return writes; },
        async close() {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        },
    };
}

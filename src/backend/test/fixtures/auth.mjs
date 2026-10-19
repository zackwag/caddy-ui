import express from 'express';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuthStore } from '../../src/authStore.js';
import { createAuthSessions } from '../../src/authSessions.js';
import { authMiddleware, initializeAuthentication } from '../../src/middleware/auth.js';
import { createCrossSiteMiddleware } from '../../src/middleware/crossSite.js';
import { createCsrfMiddleware } from '../../src/middleware/csrf.js';
import { createApiTokenMiddleware } from '../../src/middleware/apiToken.js';
import { instanceMiddleware } from '../../src/middleware/instance.js';
import { createAuthRouter } from '../../src/routes/auth.js';

export async function authFixture({ env = {}, now, store } = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-auth-http-'));
    const path = join(directory, 'auth.json');
    store ??= createAuthStore(path);
    const service = await initializeAuthentication({ store, env, now, sessions: createAuthSessions({ now }) });
    const app = express();
    app.use(express.json());
    app.use('/api', createCrossSiteMiddleware(env.CADDY_UI_EXTERNAL_URL));
    app.use('/api', createApiTokenMiddleware(service));
    app.use('/api', createCsrfMiddleware(service.sessions));
    app.use('/api/auth', createAuthRouter(() => service));
    app.get('/api/protected', authMiddleware, (_req, res) => res.json({ ok: true }));
    app.put('/api/protected', authMiddleware, (_req, res) => res.json({ ok: true }));
    for (const path of ['/status', '/metrics', '/metrics/raw']) {
        app.get('/api' + path, authMiddleware, instanceMiddleware, (req, res) => res.json({ instanceId: req.instance.id }));
    }
    app.get('/api/stream', authMiddleware, (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write('data: connected\n\n');
        req.on('close', () => res.end());
    });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return { service, store, directory, path, url: `http://127.0.0.1:${server.address().port}`,
        async close() {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
            await rm(directory, { recursive: true, force: true });
        },
    };
}

export function authClient(url) {
    let cookie = '';
    let csrfToken;
    return {
        get cookie() { return cookie; },
        async request(path, { method = 'GET', body, csrf = true, headers = {} } = {}) {
            if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrf && !csrfToken) {
                const result = await this.request('/auth/csrf');
                csrfToken = result.data.csrfToken;
            }
            const response = await fetch(url + '/api' + path, { method,
                headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrf ? { 'X-CSRF-Token': csrfToken } : {}), ...headers },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            if (response.headers.getSetCookie().length) {
                cookie = response.headers.getSetCookie().at(-1).split(';')[0];
                csrfToken = undefined;
            }
            const data = await response.json();
            return { status: response.status, data, headers: response.headers };
        },
    };
}

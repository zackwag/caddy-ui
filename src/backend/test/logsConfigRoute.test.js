import express from 'express';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execInInstance, validateCaddyfile, saveCaddyfileChange, state } = vi.hoisted(() => ({
    execInInstance: vi.fn(), validateCaddyfile: vi.fn(), saveCaddyfileChange: vi.fn(),
    state: { original: '', applied: null, adapted: null, containerName: 'test-caddy' },
}));
vi.mock('../src/docker.js', async original => ({ ...await original(), execInInstance }));
vi.mock('../src/routes/caddyfile.js', () => ({ historyWarning: () => ({}), validateCaddyfile, saveCaddyfileChange }));
vi.mock('../src/middleware/auth.js', () => ({ getAuthentication: () => ({ getActor: () => null }) }));
import logsRouter from '../src/routes/logs.js';
const { validateCaddyfile: validateViaAdminApi } = await vi.importActual('../src/routes/caddyfile.js');

const site = '# Keep the site formatting\nexample.com {\n       respond "unchanged"   # keep spacing\n}\n';

describe('logging configuration preparation', () => {
    let server;
    let url;
    beforeEach(async () => {
        vi.resetAllMocks();
        state.original = '{ # global options\n  admin off\n}\n\n' + site;
        state.applied = null;
        state.adapted = null;
        state.containerName = 'test-caddy';
        execInInstance.mockRejectedValue(Object.assign(new Error('Executable unavailable'), { code: 'ENOENT' }));
        saveCaddyfileChange.mockImplementation(async (_instance, change) => {
            const candidate = await change(state.original);
            state.applied = candidate;
            return { applied: true };
        });
        const app = express();
        app.use(express.json());
        app.post('/adapt', express.text({ type: 'text/caddyfile' }), (req, res) => {
            expect(state.applied).toBeNull();
            state.adapted = req.body;
            res.json({});
        });
        app.use('/api/logs', (req, _res, next) => {
            req.instance = { id: 'default', containerName: state.containerName, configPath: '/etc/caddy/Caddyfile',
                adminUrl: `http://127.0.0.1:${server.address().port}` };
            next();
        }, logsRouter);
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        url = `http://127.0.0.1:${server.address().port}/api/logs/config`;
    });
    afterEach(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    async function configure() {
        const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true, path: '/tmp/test.log', rollSize: '50mb', rollKeep: 5, format: 'json', level: 'INFO' }) });
        return { status: response.status, body: await response.json() };
    }

    it('preserves the current file formatting and validates before applying', async () => {
        validateCaddyfile.mockImplementation(async candidate => {
            expect(state.applied).toBeNull();
            expect(candidate.startsWith('{ # global options\n  admin off\n')).toBe(true);
            expect(candidate.endsWith(site)).toBe(true);
            expect(candidate).toContain('output file /tmp/test.log');
        });
        expect((await configure()).status).toBe(200);
        expect(execInInstance).not.toHaveBeenCalled();
        expect(validateCaddyfile).toHaveBeenCalledOnce();
        expect(state.applied).toContain('log {');
    });

    it.each(['', 'test-caddy'])('saves through admin API validation without a binary (container: "%s")', async containerName => {
        state.containerName = containerName;
        validateCaddyfile.mockImplementation(validateViaAdminApi);
        const response = await configure();
        expect(response.status).toBe(200);
        expect(state.adapted).toBe(state.applied);
        expect(state.adapted).toContain('output file /tmp/test.log');
        expect(execInInstance).not.toHaveBeenCalled();
    });

    it('does not apply when Caddy rejects the edited candidate', async () => {
        validateCaddyfile.mockRejectedValue(new Error('Caddy rejected the candidate'));
        const response = await configure();
        expect(response.status).toBe(422);
        expect(response.body.code).toBe('CADDYFILE_VALIDATION_FAILED');
        expect(state.applied).toBeNull();
    });
});

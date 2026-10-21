import express from 'express';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execInInstance, validateCaddyfile, saveCaddyfileChange, state } = vi.hoisted(() => ({
    execInInstance: vi.fn(), validateCaddyfile: vi.fn(), saveCaddyfileChange: vi.fn(),
    state: { original: '{\nadmin off\n}', applied: null },
}));
vi.mock('../src/docker.js', async original => ({ ...await original(), execInInstance }));
vi.mock('../src/routes/caddyfile.js', () => ({ historyWarning: () => ({}), validateCaddyfile, saveCaddyfileChange }));
vi.mock('../src/middleware/auth.js', () => ({ getAuthentication: () => ({ getActor: () => null }) }));
import logsRouter from '../src/routes/logs.js';

describe('logging configuration preparation', () => {
    let server;
    let url;
    beforeEach(async () => {
        vi.resetAllMocks();
        state.applied = null;
        execInInstance.mockResolvedValue({ stdout: '{\n\tadmin off\n}\n' });
        saveCaddyfileChange.mockImplementation(async (_instance, change) => {
            const candidate = await change(state.original);
            state.applied = candidate;
            return { applied: true };
        });
        const app = express();
        app.use(express.json());
        app.use('/api/logs', (req, _res, next) => { req.instance = { id: 'default', containerName: 'test-caddy' }; next(); }, logsRouter);
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

    it('edits the formatted current file and validates before applying', async () => {
        validateCaddyfile.mockImplementation(async candidate => {
            expect(state.applied).toBeNull();
            expect(candidate).toContain('\tadmin off\n');
            expect(candidate).toContain('output file /tmp/test.log');
        });
        expect((await configure()).status).toBe(200);
        expect(execInInstance).toHaveBeenCalledWith('test-caddy', 'caddy', ['fmt', '-'], state.original);
        expect(validateCaddyfile).toHaveBeenCalledOnce();
        expect(state.applied).toContain('log {');
    });

    it('does not apply or validate when formatting fails', async () => {
        execInInstance.mockRejectedValue(new Error('formatter unavailable'));
        const response = await configure();
        expect(response.status).toBe(500);
        expect(response.body.code).toBe('CADDYFILE_WRITE_FAILED');
        expect(validateCaddyfile).not.toHaveBeenCalled();
        expect(state.applied).toBeNull();
    });

    it('does not apply when Caddy rejects the edited candidate', async () => {
        validateCaddyfile.mockRejectedValue(new Error('Caddy rejected the candidate'));
        const response = await configure();
        expect(response.status).toBe(422);
        expect(response.body.code).toBe('CADDYFILE_VALIDATION_FAILED');
        expect(state.applied).toBeNull();
    });
});

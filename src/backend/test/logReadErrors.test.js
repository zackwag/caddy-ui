import express from 'express';
import { EventEmitter, once } from 'node:events';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { execInInstance, spawnInInstance } = vi.hoisted(() => ({ execInInstance: vi.fn(), spawnInInstance: vi.fn() }));
vi.mock('../src/docker.js', async original => ({ ...await original(), execInInstance, spawnInInstance }));
import logsRouter from '../src/routes/logs.js';
import { diagnosticMiddleware } from '../src/errorReporting.js';
import logger from '../src/logger.js';

const instance = { id: 'test', containerName: 'caddy', logPath: '/var/log/caddy/access.log' };
const failure = (stderr, code = 1) => Object.assign(new Error(stderr), { stderr, code });
const failures = [
    ['GNU missing file', `tail: cannot open '${instance.logPath}' for reading: No such file or directory`, 404],
    ['BusyBox missing file', `tail: can't open '${instance.logPath}': No such file or directory\ntail: no files`, 404],
    ['BSD missing file', `tail: ${instance.logPath}: No such file or directory`, 404],
    ['permissions', `tail: cannot open '${instance.logPath}' for reading: Permission denied`, 500],
    ['directory', `tail: error reading '${instance.logPath}': Is a directory`, 500],
    ['missing container', 'Error response from daemon: No such container: caddy', 500],
    ['stopped container', 'Error response from daemon: Container is not running', 500],
    ['missing tail binary', 'exec: "tail": executable file not found in $PATH: no such file or directory', 500],
    ['missing Docker binary', 'spawn docker ENOENT', 500],
    ['different missing path', 'tail: /another/path: No such file or directory', 500],
];
let server;
let url;
beforeAll(async () => {
    const app = express();
    app.use(diagnosticMiddleware);
    app.use('/api/logs', (req, _res, next) => { req.instance = instance; next(); }, logsRouter);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    url = `http://127.0.0.1:${server.address().port}/api/logs`;
});
afterAll(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
});
beforeEach(() => {
    execInInstance.mockReset();
    spawnInInstance.mockReset();
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('Caddy log snapshots', () => {
    it.each([['empty', '', []], ['populated', 'one\ntwo\n', ['one', 'two']]])('successfully reads an %s file', async (_name, stdout, lines) => {
        execInInstance.mockResolvedValue({ stdout });
        const response = await fetch(url);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ lines, path: instance.logPath });
        expect(execInInstance).toHaveBeenCalledWith('caddy', 'tail', ['-n', '200', '--', instance.logPath]);
    });

    it.each(failures)('reports %s accurately with correlated private diagnostics', async (_name, detail, status) => {
        execInInstance.mockRejectedValue(failure(detail));
        const response = await fetch(url);
        const body = await response.json();
        const code = status === 404 ? 'LOG_FILE_MISSING' : 'LOG_READ_FAILED';
        expect(response.status).toBe(status);
        expect(body).toEqual({ code, error: 'Operation failed', requestId: response.headers.get('X-Request-ID') });
        expect(body.requestId).toBeTruthy();
        const diagnostic = (status === 404 ? logger.warn : logger.error).mock.calls[0][1];
        expect(diagnostic).toMatchObject({ code, requestId: body.requestId, status });
        expect(diagnostic.causes[0].context).toEqual({ instanceId: 'test', containerName: 'caddy', logPath: instance.logPath });
        expect(diagnostic.causes[1].message).toBe(detail);
    });
});

function streamProcess(emit) {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
    spawnInInstance.mockImplementation(() => {
        setImmediate(() => emit(child));
        return child;
    });
    return child;
}

describe('Caddy live log failures', () => {
    it.each(failures)('reports %s after collecting stderr', async (_name, detail, status) => {
        streamProcess(child => {
            const split = Math.floor(detail.length / 2);
            child.stderr.emit('data', Buffer.from(detail.slice(0, split)));
            child.stderr.emit('data', Buffer.from(detail.slice(split)));
            child.emit('close', 1);
        });
        const response = await fetch(url + '/stream');
        const events = (await response.text()).trim().split('\n\n').map(event => JSON.parse(event.slice(6)));
        // SSE errors are events on an established HTTP 200 stream.
        expect(events).toEqual([{ code: status === 404 ? 'LOG_FILE_MISSING' : 'LOG_STREAM_ERROR',
            error: 'Operation failed', requestId: response.headers.get('X-Request-ID') }]);
    });

    it('reports a process-start error once, without calling it a missing log file', async () => {
        streamProcess(child => {
            child.emit('error', failure('spawn docker ENOENT', null));
            child.emit('close', -2);
        });
        const response = await fetch(url + '/stream');
        const body = await response.text();
        expect(body.match(/data:/g)).toHaveLength(1);
        expect(JSON.parse(body.trim().slice(6)).code).toBe('LOG_STREAM_ERROR');
        expect(logger.error).toHaveBeenCalledOnce();
    });

    it('continues delivering lines after a nonfatal truncation warning', async () => {
        streamProcess(child => {
            child.stderr.emit('data', Buffer.from(`tail: ${instance.logPath}: file truncated`));
            child.stdout.emit('data', Buffer.from('first\nsecond\n'));
            child.emit('close', 0);
        });
        const response = await fetch(url + '/stream');
        expect(await response.text()).toBe('data: {"line":"first"}\n\ndata: {"line":"second"}\n\n');
        expect(logger.error).not.toHaveBeenCalled();
    });
});

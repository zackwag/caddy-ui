import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('child_process', () => ({ spawn }));

const { containerPathExists, describeReadError, readContainerDir, readContainerFile, removeContainerPath, writeContainerFile }
    = await import('../src/containerFs.js');
const { dockerExec } = await import('../src/docker.js');

describe('Docker-mode paths', () => {
    beforeEach(() => spawn.mockReset());

    const operations = {
        read: path => readContainerFile('caddy', path),
        write: path => writeContainerFile('caddy', path, 'content'),
        list: path => readContainerDir('caddy', path),
        remove: path => removeContainerPath('caddy', path),
    };

    for (const path of ['/etc/caddy/../../root/.ssh/id_rsa', '/etc/caddy/Caddy\0file', '/etc/caddy/Caddyfile\nother']) {
        it.each(Object.keys(operations))(`rejects ${JSON.stringify(path)} for %s before running anything`, async operation => {
            await expect(operations[operation](path)).rejects.toThrow(/^Invalid (path|command) argument$/);
            expect(spawn).not.toHaveBeenCalled();
        });

        it(`never reports ${JSON.stringify(path)} as existing`, async () => {
            expect(await containerPathExists('caddy', path)).toBe(false);
            expect(spawn).not.toHaveBeenCalled();
        });
    }

    it('checks that a path exists with a command every test implementation accepts', async () => {
        const { EventEmitter } = await import('node:events');
        spawn.mockImplementationOnce(() => {
            const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
            setImmediate(() => proc.emit('close', 0));
            return proc;
        });
        expect(await containerPathExists('caddy', '/data/caddy')).toBe(true);
        expect(spawn).toHaveBeenCalledWith('docker', ['exec', '-i', 'caddy', 'ls', '-d', '--', '/data/caddy'], { shell: false });
    });

    it('requires file commands to separate their paths with --', () => {
        expect(() => dockerExec('caddy', ['cat', '/etc/caddy/Caddyfile'])).toThrow('Missing path argument');
        expect(() => dockerExec('caddy', ['rm', '-rf', '--'])).toThrow('Missing path argument');
        expect(spawn).not.toHaveBeenCalled();
    });
});

describe('describeReadError', () => {
    it('reports missing paths in local mode', () => {
        const err = Object.assign(new Error("ENOENT: no such file or directory, scandir '/data/caddy/certificates'"), { code: 'ENOENT' });
        expect(describeReadError(err)).toBe('not found');
    });

    it('reports permission problems in local mode', () => {
        const err = Object.assign(new Error("EACCES: permission denied, scandir '/data/caddy/certificates'"), { code: 'EACCES' });
        expect(describeReadError(err)).toBe('permission denied');
    });

    it('reads the stderr of docker exec commands', () => {
        const stderr = 'ls: /data/caddy/certificates: No such file or directory';
        const err = Object.assign(new Error(stderr), { stderr, code: 1 });
        expect(describeReadError(err)).toBe('not found');
    });

    it("doesn't mistake an unreachable Docker daemon for a file permission problem", () => {
        const stderr = 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock';
        const err = Object.assign(new Error(stderr), { stderr, code: 1 });
        expect(describeReadError(err)).toBe(stderr);
    });
});

import { describe, expect, it } from 'vitest';
import { describeReadError } from '../src/containerFs.js';

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

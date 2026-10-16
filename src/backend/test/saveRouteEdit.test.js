import { mkdtempSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { files, caddyLoad } = vi.hoisted(() => ({ files: new Map(), caddyLoad: vi.fn() }));

vi.mock('../src/containerFs.js', () => ({
    readContainerFile: vi.fn(async (container, path) => {
        if (!files.has(path)) throw new Error('ENOENT');
        return files.get(path);
    }),
    writeContainerFile: vi.fn(async (container, path, content) => { files.set(path, content); }),
    removeContainerPath: vi.fn(),
}));

vi.mock('../src/caddy.js', () => ({ caddyLoad, withTimeout: p => p }));

// HISTORY_PATH is read at import time, so set it before importing the module
process.env.HISTORY_PATH = mkdtempSync(join(tmpdir(), 'caddy-ui-history-'));
const { saveRouteEdit } = await import('../src/routes/caddyfile.js');

// Local mode (no container), so a failed /load has no binary fallback
const instance = { id: 'default', adminUrl: 'http://caddy:2019', configPath: '/etc/caddy/Caddyfile', containerName: '' };
const historyFiles = () => readdirSync(process.env.HISTORY_PATH).filter(f => f.startsWith('Caddyfile-'));

describe('saveRouteEdit', () => {
    beforeEach(() => {
        files.clear();
        files.set(instance.configPath, 'old.example.com {\n}\n');
        caddyLoad.mockReset();
    });

    it('writes, reloads, and snapshots the previous file', async () => {
        caddyLoad.mockResolvedValue(null);
        const before = historyFiles().length;
        await saveRouteEdit(instance, 'new.example.com {\n}\n');
        expect(files.get(instance.configPath)).toBe('new.example.com {\n}\n');
        expect(caddyLoad).toHaveBeenCalledWith('new.example.com {\n}\n', instance.adminUrl);
        expect(historyFiles().length).toBeGreaterThan(before);
    });

    it('restores the previous file when Caddy rejects the change', async () => {
        caddyLoad.mockRejectedValue(new Error('Caddy API error: 400 adapting config'));
        await expect(saveRouteEdit(instance, 'broken {\n')).rejects.toThrow(/Caddyfile was restored/);
        expect(files.get(instance.configPath)).toBe('old.example.com {\n}\n');
    });

    it('skips the reload for edits already applied through the admin API', async () => {
        await saveRouteEdit(instance, 'api.example.com {\n}\n', { reload: false });
        expect(files.get(instance.configPath)).toBe('api.example.com {\n}\n');
        expect(caddyLoad).not.toHaveBeenCalled();
    });
});

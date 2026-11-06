import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let directory, file;
beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'caddy-ui-settings-'));
    file = join(directory, 'settings.json');
    vi.stubEnv('SETTINGS_PATH', file);
});
afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
});

async function reloadSettings() {
    vi.resetModules();
    const settings = await import('../src/settings.js');
    await settings.loadSettings();
    return settings;
}

it('defaults Vim off for an existing settings file while preserving other preferences', async () => {
    await writeFile(file, JSON.stringify({ theme: 'light', language: 'en', firstTimeRun: false }));
    const settings = await reloadSettings();
    expect(settings.getSettings()).toMatchObject({ editorVim: false, theme: 'light', language: 'en', firstTimeRun: false });
});

it('retains enabling and disabling Vim across settings module reloads', async () => {
    let settings = await reloadSettings();
    expect(settings.getSettings().editorVim).toBe(false);
    for (const editorVim of [true, false]) {
        await settings.saveSettings({ editorVim });
        expect(JSON.parse(await readFile(file, 'utf8')).editorVim).toBe(editorVim);
        settings = await reloadSettings();
        expect(settings.getSettings().editorVim).toBe(editorVim);
    }
});

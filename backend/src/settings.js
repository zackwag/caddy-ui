import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import logger from './logger.js';

const SETTINGS_PATH = process.env.SETTINGS_PATH || '/etc/caddy-ui/settings.json';

const DEFAULT_SETTINGS = {
    firstTimeRun: true,
    theme: 'dark',
    darkPalette: 'vt2026',
    lightPalette: 'coarse-everywhere',
    routeColumns: { status: true, title: true, upstream: true, server: true, id: true },
};

let _settings = null;
let _writeLock = Promise.resolve();

export async function loadSettings() {
    try {
        const raw = await readFile(SETTINGS_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            _settings = { ...DEFAULT_SETTINGS, ...parsed };
            return _settings;
        }
    } catch { }
    _settings = { ...DEFAULT_SETTINGS };
    return _settings;
}

export function getSettings() {
    return _settings || { ...DEFAULT_SETTINGS };
}

export async function saveSettings(updates) {
    _settings = { ..._settings, ...updates };
    _writeLock = _writeLock.then(async () => {
        await mkdir(dirname(SETTINGS_PATH), { recursive: true });
        await writeFile(SETTINGS_PATH, JSON.stringify(_settings, null, 2), 'utf8');
    });
    await _writeLock;
    logger.info('Settings updated', { keys: Object.keys(updates) });
    return _settings;
}

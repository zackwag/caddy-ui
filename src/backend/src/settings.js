import { createJsonStore } from './jsonFile.js';
import { normalizeLanguageSetting } from './languages.js';
import logger from './logger.js';

const SETTINGS_PATH = process.env.SETTINGS_PATH || '/etc/caddy-ui/settings.json';

const DEFAULT_SETTINGS = Object.freeze({
    firstTimeRun: true,
    theme: 'dark',
    language: null,
    editorVim: false,
    darkPalette: 'vt2026',
    lightPalette: 'coarse-everywhere',
    routeColumns: Object.freeze({ status: true, title: true, upstream: true, server: true, id: true }),
    routeChecks: false,
    routeCheckExcludes: Object.freeze([]),
});

const MAX_EXCLUDES = 500;
const MAX_HOST_LENGTH = 253;

// Unique, trimmed, lowercased hosts.
export function sanitizeHostList(value) {
    if (!Array.isArray(value)) return [];
    const hosts = value
        .filter(h => typeof h === 'string')
        .map(h => h.trim().toLowerCase())
        .filter(h => h && h.length <= MAX_HOST_LENGTH);
    return [...new Set(hosts)].slice(0, MAX_EXCLUDES);
}

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const keep = value => value;

// How a submitted value for each setting is stored. Undefined rejects it.
const NORMALIZERS = {
    firstTimeRun: keep,
    theme: keep,
    language: normalizeLanguageSetting,
    editorVim: value => value === true,
    darkPalette: keep,
    lightPalette: keep,
    routeColumns: value => (isObject(value) ? { ...DEFAULT_SETTINGS.routeColumns, ...value } : undefined),
    routeChecks: value => value === true,
    routeCheckExcludes: sanitizeHostList,
};

function withDefaults(saved) {
    const settings = structuredClone({ ...DEFAULT_SETTINGS, ...(isObject(saved) ? saved : {}) });
    settings.routeColumns = { ...DEFAULT_SETTINGS.routeColumns, ...(isObject(settings.routeColumns) ? settings.routeColumns : {}) };
    return settings;
}

const store = createJsonStore(SETTINGS_PATH, { parse: withDefaults });

export function loadSettings() {
    return store.load();
}

export function getSettings() {
    return store.get();
}

export class InvalidSettingError extends Error {}

// The known settings in `body`, normalized. Throws InvalidSettingError when
// none are given or one can't be stored.
export function settingsUpdate(body) {
    const updates = {};
    for (const [key, normalize] of Object.entries(NORMALIZERS)) {
        if (!isObject(body) || !(key in body)) continue;
        const value = normalize(body[key]);
        if (value === undefined) throw new InvalidSettingError(`Unsupported ${key}`);
        updates[key] = value;
    }
    if (!Object.keys(updates).length) throw new InvalidSettingError('No valid settings provided');
    return updates;
}

export async function saveSettings(updates) {
    const settings = await store.update(current => ({ ...current, ...updates }));
    logger.info('Settings updated', { keys: Object.keys(updates) });
    return settings;
}

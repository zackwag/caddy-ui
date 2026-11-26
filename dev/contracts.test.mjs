// What the backend and frontend packages must agree on. They're built and
// deployed separately, so nothing else connects these lists.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ERROR_REGISTRY } from '../src/backend/src/errorRegistry.js';
import { REQUIRED_VARS } from '../src/backend/src/customThemes.js';
import { getNotificationConfig } from '../src/backend/src/notificationConfig.js';
import { DEFAULT_SETTINGS as BACKEND_SETTINGS } from '../src/backend/src/settings.js';
import en from '../src/frontend/src/i18n/locales/en.js';
import { DEFAULT_SETTINGS as FRONTEND_SETTINGS } from '../src/frontend/src/settings.js';
import { DEFAULT_PALETTES, THEME_LIST, THEME_VAR_KEYS } from '../src/frontend/src/styles.js';
import { ERROR_MESSAGES } from '../src/frontend/src/utils/errorRegistry.js';

const message = key => key.split('.').reduce((catalog, name) => catalog?.[name], en);

test('every error the backend reports has a message in the UI', () => {
    assert.deepEqual(Object.keys(ERROR_REGISTRY).filter(code => typeof message(ERROR_MESSAGES[code] ?? '') !== 'string'), []);
});

test('custom themes must define exactly the variables built-in themes do', () => {
    assert.deepEqual([...REQUIRED_VARS].sort(), [...THEME_VAR_KEYS].sort());
    for (const theme of THEME_LIST) assert.deepEqual(Object.keys(theme.vars).sort(), [...REQUIRED_VARS].sort(), theme.id);
});

test('the UI starts from the settings the backend stores', () => {
    // Shown once on first run, then never read by the UI
    const { firstTimeRun, ...stored } = BACKEND_SETTINGS;
    assert.equal(firstTimeRun, true);
    assert.deepEqual(FRONTEND_SETTINGS, stored);
    assert.deepEqual(DEFAULT_PALETTES, { dark: BACKEND_SETTINGS.darkPalette, light: BACKEND_SETTINGS.lightPalette });
});

test('every notification trigger is labeled in the UI', () => {
    assert.deepEqual(Object.keys(getNotificationConfig().triggers).filter(trigger => typeof message(`notifications.${trigger}`) !== 'string'), []);
});

test("the documentation's mdBook themes use the UI's default palettes", () => {
    const css = readFileSync(new URL('../docs/theme/palettes.css', import.meta.url), 'utf8');
    const modes = { light: 'light', rust: 'light', navy: 'dark', coal: 'dark', ayu: 'dark' };
    const themes = Object.fromEntries([...css.matchAll(/^\.(\w+) \{([^}]*)\}/gm)].map(([, name, body]) =>
        [name, Object.fromEntries([...body.matchAll(/--app-([\w-]+): ([^;]+);/g)].map(([, name, value]) => [`--${name}`, value]))]));
    assert.deepEqual(Object.keys(themes).sort(), Object.keys(modes).sort());
    for (const [name, mode] of Object.entries(modes)) {
        assert.deepEqual(themes[name], THEME_LIST.find(theme => theme.id === DEFAULT_PALETTES[mode]).vars, name);
    }
});

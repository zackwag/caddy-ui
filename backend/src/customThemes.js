import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { basename, extname, join } from 'path';
import logger from './logger.js';

const THEMES_PATH = process.env.THEMES_PATH || '/etc/caddy-ui/themes';

// Must match the variable set every built-in theme defines in
// frontend/src/styles.js -- a custom theme missing any of these would
// leave that color undefined rather than falling back to something sane.
const REQUIRED_VARS = [
    '--bg', '--surface', '--border', '--border2', '--text', '--muted',
    '--accent', '--accent2', '--accent3', '--danger', '--warn',
    '--editor-bg', '--editor-gutter', '--editor-border', '--editor-text',
    '--editor-active-gutter', '--editor-active-line', '--editor-selection', '--log-bg',
];

// Dropped into both themes/dark/ and themes/light/ on first run, so the
// format is documented right where a user is already looking. The two
// folders get the identical file -- the schema doesn't differ by mode,
// only which folder a theme file lives in does. Built as a joined array
// (not a template literal) so none of the markdown backticks need escaping.
const THEME_README = [
    '# Custom Themes',
    '',
    'Drop a `.json` file in this folder to add a custom theme. caddy/ui scans',
    'this folder (and its sibling `dark`/`light` folder) once at startup.',
    '',
    'The filename becomes the theme\'s id (e.g. `my-theme.json`), and **which',
    'folder you put the file in** -- this one, or its `dark`/`light` sibling --',
    'is what determines whether it shows up in the "Dark theme" or "Light',
    'theme" picker. The file\'s content doesn\'t need to say which mode it is.',
    '',
    '## Format',
    '',
    '```json',
    '{',
    '  "label": "My Theme",',
    '  "vars": {',
    '    "--bg": "#0d0f12",',
    '    "--surface": "#13161b",',
    '    "--border": "#1e2329",',
    '    "--border2": "#2a3040",',
    '    "--text": "#c9d1e0",',
    '    "--muted": "#586275",',
    '    "--accent": "#00e5a0",',
    '    "--accent2": "#0099ff",',
    '    "--accent3": "#b388ff",',
    '    "--danger": "#ff4d6a",',
    '    "--warn": "#ffb830",',
    '    "--editor-bg": "#0a0c0f",',
    '    "--editor-gutter": "#0d0f12",',
    '    "--editor-border": "#1e2329",',
    '    "--editor-text": "#a8d8a8",',
    '    "--editor-active-gutter": "rgba(0,229,160,0.05)",',
    '    "--editor-active-line": "rgba(0,229,160,0.03)",',
    '    "--editor-selection": "rgba(0,153,255,0.2)",',
    '    "--log-bg": "#0a0c0f"',
    '  }',
    '}',
    '```',
    '',
    '`label` is the name shown in the theme picker. All 18 `vars` keys are',
    'required -- a file missing any of them, or that isn\'t valid JSON, is',
    'skipped (check the backend logs for why).',
    '',
    '## Variable reference',
    '',
    '| Variable | Used for |',
    '|---|---|',
    '| `--bg` | Page background |',
    '| `--surface` | Card / sidebar background |',
    '| `--border` | Default border color |',
    '| `--border2` | Slightly stronger border (inputs, dividers) |',
    '| `--text` | Primary text |',
    '| `--muted` | Secondary/muted text |',
    '| `--accent` | Primary highlight (buttons, links, online status) |',
    '| `--accent2` | Secondary highlight (info, numbers) |',
    '| `--accent3` | Tertiary highlight (a second variable-name color in the Caddyfile editor) |',
    '| `--danger` | Errors, offline status, destructive actions |',
    '| `--warn` | Warnings |',
    '| `--editor-bg` | Caddyfile editor background |',
    '| `--editor-gutter` | Caddyfile editor line-number gutter |',
    '| `--editor-border` | Border between the gutter and the editor |',
    '| `--editor-text` | Caddyfile editor body text |',
    '| `--editor-active-gutter` | Highlighted line\'s gutter background (usually a translucent accent) |',
    '| `--editor-active-line` | Highlighted line\'s background (usually a translucent accent, fainter) |',
    '| `--editor-selection` | Text selection background |',
    '| `--log-bg` | Access log viewer background |',
    '',
    'After adding or editing a file here, restart caddy-ui to pick it up.',
    '',
].join('\n');

let _customThemes = [];

export function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Parses and validates one theme file's contents. Pure and I/O-free so it's
// directly testable; throws a descriptive Error on any validation failure.
export function parseThemeFile(mode, filename, raw) {
    const slug = slugify(basename(filename, '.json'));
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('file is not a JSON object');
    }
    if (typeof parsed.label !== 'string' || !parsed.label.trim()) {
        throw new Error('missing a "label" string');
    }
    if (!parsed.vars || typeof parsed.vars !== 'object' || Array.isArray(parsed.vars)) {
        throw new Error('missing a "vars" object');
    }
    const missing = REQUIRED_VARS.filter(v => typeof parsed.vars[v] !== 'string' || !parsed.vars[v].trim());
    if (missing.length) {
        throw new Error(`"vars" is missing: ${missing.join(', ')}`);
    }
    if (!slug) {
        throw new Error('filename has no usable characters for an id');
    }
    return {
        id: `custom-${mode}-${slug}`,
        label: parsed.label.trim(),
        mode,
        custom: true,
        vars: Object.fromEntries(REQUIRED_VARS.map(v => [v, parsed.vars[v].trim()])),
    };
}

// Creates themes/<mode>/ if missing and drops the template README in it if
// one isn't already there. Runs on every startup, but 'wx' makes the write
// a no-op (EEXIST) once the file exists, so it won't clobber anything the
// user has since edited or removed on purpose.
async function ensureThemeFolder(mode) {
    const dir = join(THEMES_PATH, mode);
    try {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'README.md'), THEME_README, { flag: 'wx' });
    } catch (err) {
        if (err.code !== 'EEXIST') {
            logger.warn('Could not set up custom themes folder', { dir, error: err.message });
        }
    }
}

async function scanMode(mode) {
    const dir = join(THEMES_PATH, mode);
    let files;
    try {
        files = await readdir(dir);
    } catch {
        return []; // folder doesn't exist -- nothing to load, not an error
    }

    const themes = [];
    for (const file of files) {
        if (extname(file) !== '.json') continue;
        try {
            const raw = await readFile(join(dir, file), 'utf8');
            themes.push(parseThemeFile(mode, file, raw));
        } catch (err) {
            logger.warn('Skipped invalid custom theme file', { file: `${mode}/${file}`, error: err.message });
        }
    }
    return themes;
}

export async function loadCustomThemes() {
    await Promise.all([ensureThemeFolder('dark'), ensureThemeFolder('light')]);
    const [dark, light] = await Promise.all([scanMode('dark'), scanMode('light')]);
    _customThemes = [...dark, ...light];
    if (_customThemes.length) {
        logger.info('Loaded custom themes', { count: _customThemes.length, ids: _customThemes.map(t => t.id) });
    }
    return _customThemes;
}

export function getCustomThemes() {
    return _customThemes;
}

import { describe, expect, it } from 'vitest';
import { parseThemeFile, slugify } from '../src/customThemes.js';

const VALID_VARS = {
    '--bg': '#111111',
    '--surface': '#222222',
    '--border': '#333333',
    '--border2': '#444444',
    '--text': '#eeeeee',
    '--muted': '#999999',
    '--accent': '#00ff00',
    '--accent2': '#00ffff',
    '--accent3': '#ff00ff',
    '--danger': '#ff0000',
    '--warn': '#ffff00',
    '--editor-bg': '#101010',
    '--editor-gutter': '#202020',
    '--editor-border': '#303030',
    '--editor-text': '#a0a0a0',
    '--editor-active-gutter': 'rgba(0,255,0,0.05)',
    '--editor-active-line': 'rgba(0,255,0,0.03)',
    '--editor-selection': 'rgba(0,255,255,0.2)',
    '--log-bg': '#101010',
    '--scrim': 'rgba(0,0,0,0.55)',
    '--on-accent': '#fff',
    '--on-danger': '#fff',
};

describe('slugify', () => {
    it('lowercases and hyphenates', () => {
        expect(slugify('My Cool Theme')).toBe('my-cool-theme');
    });

    it('strips characters outside a-z0-9', () => {
        expect(slugify('Theme_v2!!!')).toBe('theme-v2');
    });

    it('trims leading/trailing hyphens', () => {
        expect(slugify('--edgy--')).toBe('edgy');
    });
});

describe('parseThemeFile', () => {
    it('parses a valid theme file', () => {
        const raw = JSON.stringify({ label: 'My Theme', vars: VALID_VARS });
        const theme = parseThemeFile('dark', 'my-theme.json', raw);
        expect(theme).toEqual({
            id: 'custom-dark-my-theme',
            label: 'My Theme',
            mode: 'dark',
            custom: true,
            vars: VALID_VARS,
        });
    });

    it('derives the id from the filename, not the label', () => {
        const raw = JSON.stringify({ label: 'Totally Different Name', vars: VALID_VARS });
        const theme = parseThemeFile('light', 'Some File Name.json', raw);
        expect(theme.id).toBe('custom-light-some-file-name');
    });

    it('trims whitespace from label and var values', () => {
        const raw = JSON.stringify({ label: '  Padded  ', vars: { ...VALID_VARS, '--bg': '  #123456  ' } });
        const theme = parseThemeFile('dark', 'padded.json', raw);
        expect(theme.label).toBe('Padded');
        expect(theme.vars['--bg']).toBe('#123456');
    });

    it('rejects invalid JSON', () => {
        expect(() => parseThemeFile('dark', 'bad.json', '{not json')).toThrow();
    });

    it('rejects a JSON array', () => {
        expect(() => parseThemeFile('dark', 'bad.json', '[]')).toThrow('not a JSON object');
    });

    it('rejects a missing label', () => {
        const raw = JSON.stringify({ vars: VALID_VARS });
        expect(() => parseThemeFile('dark', 'bad.json', raw)).toThrow('label');
    });

    it('rejects a missing vars object', () => {
        const raw = JSON.stringify({ label: 'No Vars' });
        expect(() => parseThemeFile('dark', 'bad.json', raw)).toThrow('vars');
    });

    it('rejects vars missing required keys', () => {
        const incomplete = { ...VALID_VARS };
        delete incomplete['--accent3'];
        const raw = JSON.stringify({ label: 'Incomplete', vars: incomplete });
        expect(() => parseThemeFile('dark', 'bad.json', raw)).toThrow('--accent3');
    });

    it('rejects a filename with no usable slug characters', () => {
        const raw = JSON.stringify({ label: 'Emoji', vars: VALID_VARS });
        expect(() => parseThemeFile('dark', '!!!.json', raw)).toThrow('id');
    });
});

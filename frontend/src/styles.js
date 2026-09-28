// Named palettes. Each has a `mode` (dark or light) -- the app lets a user
// pick one palette to use in dark mode and one to use in light mode, and
// the existing dark/light toggle switches between whichever two are
// selected. Adding a new theme is just adding an entry here; every rule in
// this stylesheet and every editor color in CaddyfileCodeMirror/
// MiniCodeMirror reads from these variables rather than hardcoding colors,
// so a new theme needs no other changes.
export const THEME_LIST = [
    {
        id: 'vt2026', label: 'VT2026', mode: 'dark', vars: {
            '--bg': '#0d0f12',
            '--surface': '#13161b',
            '--border': '#1e2329',
            '--border2': '#2a3040',
            '--text': '#c9d1e0',
            '--muted': '#586275',
            '--accent': '#00e5a0',
            '--accent2': '#0099ff',
            '--accent3': '#b388ff',
            '--danger': '#ff4d6a',
            '--warn': '#ffb830',
            '--editor-bg': '#0a0c0f',
            '--editor-gutter': '#0d0f12',
            '--editor-border': '#1e2329',
            '--editor-text': '#a8d8a8',
            '--editor-active-gutter': 'rgba(0,229,160,0.05)',
            '--editor-active-line': 'rgba(0,229,160,0.03)',
            '--editor-selection': 'rgba(0,153,255,0.2)',
            '--log-bg': '#0a0c0f',
        },
    },
    {
        id: 'coarse-everywhere', label: 'CoarseEverywhere', mode: 'light', vars: {
            '--bg': '#f5f0eb',
            '--surface': '#faf7f4',
            '--border': '#e0d8d0',
            '--border2': '#ccc4ba',
            '--text': '#2c2825',
            '--muted': '#8a7f75',
            '--accent': '#00956b',
            '--accent2': '#0077cc',
            '--accent3': '#7c4dff',
            '--danger': '#cc2233',
            '--warn': '#b36000',
            '--editor-bg': '#f0ebe4',
            '--editor-gutter': '#e8e2db',
            '--editor-border': '#d0c8c0',
            '--editor-text': '#3a5c3a',
            '--editor-active-gutter': 'rgba(0,149,107,0.05)',
            '--editor-active-line': 'rgba(0,149,107,0.03)',
            '--editor-selection': 'rgba(0,119,204,0.15)',
            '--log-bg': '#f0ebe4',
        },
    },
    {
        id: 'nord', label: 'Nord', mode: 'dark', vars: {
            '--bg': '#2e3440',
            '--surface': '#3b4252',
            '--border': '#434c5e',
            '--border2': '#4c566a',
            '--text': '#eceff4',
            '--muted': '#4c566a',
            '--accent': '#a3be8c',
            '--accent2': '#81a1c1',
            '--accent3': '#b48ead',
            '--danger': '#bf616a',
            '--warn': '#ebcb8b',
            '--editor-bg': '#2e3440',
            '--editor-gutter': '#3b4252',
            '--editor-border': '#434c5e',
            '--editor-text': '#a3be8c',
            '--editor-active-gutter': 'rgba(163,190,140,0.08)',
            '--editor-active-line': 'rgba(163,190,140,0.05)',
            '--editor-selection': 'rgba(129,161,193,0.25)',
            '--log-bg': '#2e3440',
        },
    },
    {
        id: 'solarized-dark', label: 'Solarized Dark', mode: 'dark', vars: {
            '--bg': '#002b36',
            '--surface': '#073642',
            '--border': '#0a4552',
            '--border2': '#0d5566',
            '--text': '#839496',
            '--muted': '#586e75',
            '--accent': '#859900',
            '--accent2': '#268bd2',
            '--accent3': '#6c71c4',
            '--danger': '#dc322f',
            '--warn': '#b58900',
            '--editor-bg': '#002b36',
            '--editor-gutter': '#073642',
            '--editor-border': '#0a4552',
            '--editor-text': '#93a1a1',
            '--editor-active-gutter': 'rgba(133,153,0,0.08)',
            '--editor-active-line': 'rgba(133,153,0,0.05)',
            '--editor-selection': 'rgba(38,139,210,0.25)',
            '--log-bg': '#002b36',
        },
    },
    {
        id: 'solarized-light', label: 'Solarized Light', mode: 'light', vars: {
            '--bg': '#fdf6e3',
            '--surface': '#eee8d5',
            '--border': '#e4dcc5',
            '--border2': '#d7cfb8',
            '--text': '#657b83',
            '--muted': '#93a1a1',
            '--accent': '#859900',
            '--accent2': '#268bd2',
            '--accent3': '#6c71c4',
            '--danger': '#dc322f',
            '--warn': '#b58900',
            '--editor-bg': '#fdf6e3',
            '--editor-gutter': '#eee8d5',
            '--editor-border': '#ddd6c1',
            '--editor-text': '#586e75',
            '--editor-active-gutter': 'rgba(133,153,0,0.08)',
            '--editor-active-line': 'rgba(133,153,0,0.05)',
            '--editor-selection': 'rgba(38,139,210,0.15)',
            '--log-bg': '#fdf6e3',
        },
    },
    {
        id: 'dracula', label: 'Dracula', mode: 'dark', vars: {
            '--bg': '#282a36',
            '--surface': '#343746',
            '--border': '#44475a',
            '--border2': '#6272a4',
            '--text': '#f8f8f2',
            '--muted': '#6272a4',
            '--accent': '#50fa7b',
            '--accent2': '#8be9fd',
            '--accent3': '#bd93f9',
            '--danger': '#ff5555',
            '--warn': '#f1fa8c',
            '--editor-bg': '#282a36',
            '--editor-gutter': '#343746',
            '--editor-border': '#44475a',
            '--editor-text': '#50fa7b',
            '--editor-active-gutter': 'rgba(80,250,123,0.08)',
            '--editor-active-line': 'rgba(80,250,123,0.05)',
            '--editor-selection': 'rgba(139,233,253,0.25)',
            '--log-bg': '#282a36',
        },
    },
    {
        id: 'gruvbox-dark', label: 'Gruvbox Dark', mode: 'dark', vars: {
            '--bg': '#282828',
            '--surface': '#3c3836',
            '--border': '#504945',
            '--border2': '#665c54',
            '--text': '#ebdbb2',
            '--muted': '#928374',
            '--accent': '#b8bb26',
            '--accent2': '#83a598',
            '--accent3': '#d3869b',
            '--danger': '#fb4934',
            '--warn': '#fabd2f',
            '--editor-bg': '#1d2021',
            '--editor-gutter': '#282828',
            '--editor-border': '#504945',
            '--editor-text': '#b8bb26',
            '--editor-active-gutter': 'rgba(184,187,38,0.08)',
            '--editor-active-line': 'rgba(184,187,38,0.05)',
            '--editor-selection': 'rgba(131,165,152,0.25)',
            '--log-bg': '#1d2021',
        },
    },
    {
        id: 'catppuccin-mocha', label: 'Catppuccin Mocha', mode: 'dark', vars: {
            '--bg': '#1e1e2e',
            '--surface': '#313244',
            '--border': '#45475a',
            '--border2': '#585b70',
            '--text': '#cdd6f4',
            '--muted': '#6c7086',
            '--accent': '#a6e3a1',
            '--accent2': '#89b4fa',
            '--accent3': '#cba6f7',
            '--danger': '#f38ba8',
            '--warn': '#f9e2af',
            '--editor-bg': '#181825',
            '--editor-gutter': '#1e1e2e',
            '--editor-border': '#45475a',
            '--editor-text': '#a6e3a1',
            '--editor-active-gutter': 'rgba(166,227,161,0.08)',
            '--editor-active-line': 'rgba(166,227,161,0.05)',
            '--editor-selection': 'rgba(137,180,250,0.25)',
            '--log-bg': '#181825',
        },
    },
    {
        id: 'tokyo-night', label: 'Tokyo Night', mode: 'dark', vars: {
            '--bg': '#1a1b26',
            '--surface': '#24283b',
            '--border': '#33384d',
            '--border2': '#414868',
            '--text': '#c0caf5',
            '--muted': '#565f89',
            '--accent': '#9ece6a',
            '--accent2': '#7aa2f7',
            '--accent3': '#bb9af7',
            '--danger': '#f7768e',
            '--warn': '#e0af68',
            '--editor-bg': '#1a1b26',
            '--editor-gutter': '#24283b',
            '--editor-border': '#33384d',
            '--editor-text': '#9ece6a',
            '--editor-active-gutter': 'rgba(158,206,106,0.08)',
            '--editor-active-line': 'rgba(158,206,106,0.05)',
            '--editor-selection': 'rgba(122,162,247,0.25)',
            '--log-bg': '#1a1b26',
        },
    },
    {
        id: 'one-dark-pro', label: 'One Dark Pro', mode: 'dark', vars: {
            '--bg': '#282c34',
            '--surface': '#21252b',
            '--border': '#181a1f',
            '--border2': '#3b4048',
            '--text': '#abb2bf',
            '--muted': '#5c6370',
            '--accent': '#89ca78',
            '--accent2': '#61afef',
            '--accent3': '#d55fde',
            '--danger': '#ef596f',
            '--warn': '#e5c07b',
            '--editor-bg': '#282c34',
            '--editor-gutter': '#21252b',
            '--editor-border': '#181a1f',
            '--editor-text': '#89ca78',
            '--editor-active-gutter': 'rgba(137,202,120,0.08)',
            '--editor-active-line': 'rgba(137,202,120,0.05)',
            '--editor-selection': 'rgba(97,175,239,0.25)',
            '--log-bg': '#282c34',
        },
    },
    {
        id: 'gruvbox-light', label: 'Gruvbox Light', mode: 'light', vars: {
            '--bg': '#fbf1c7',
            '--surface': '#f2e5bc',
            '--border': '#d5c4a1',
            '--border2': '#bdae93',
            '--text': '#3c3836',
            '--muted': '#928374',
            '--accent': '#79740e',
            '--accent2': '#076678',
            '--accent3': '#8f3f71',
            '--danger': '#9d0006',
            '--warn': '#b57614',
            '--editor-bg': '#f9f5d7',
            '--editor-gutter': '#f2e5bc',
            '--editor-border': '#d5c4a1',
            '--editor-text': '#427b58',
            '--editor-active-gutter': 'rgba(121,116,14,0.08)',
            '--editor-active-line': 'rgba(121,116,14,0.05)',
            '--editor-selection': 'rgba(7,102,120,0.2)',
            '--log-bg': '#f9f5d7',
        },
    },
    {
        id: 'catppuccin-latte', label: 'Catppuccin Latte', mode: 'light', vars: {
            '--bg': '#eff1f5',
            '--surface': '#e6e9ef',
            '--border': '#ccd0da',
            '--border2': '#bcc0cc',
            '--text': '#4c4f69',
            '--muted': '#8c8fa1',
            '--accent': '#40a02b',
            '--accent2': '#1e66f5',
            '--accent3': '#8839ef',
            '--danger': '#d20f39',
            '--warn': '#df8e1d',
            '--editor-bg': '#eff1f5',
            '--editor-gutter': '#e6e9ef',
            '--editor-border': '#ccd0da',
            '--editor-text': '#40a02b',
            '--editor-active-gutter': 'rgba(64,160,43,0.08)',
            '--editor-active-line': 'rgba(64,160,43,0.05)',
            '--editor-selection': 'rgba(30,102,245,0.15)',
            '--log-bg': '#eff1f5',
        },
    },
    {
        id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', mode: 'light', vars: {
            '--bg': '#faf4ed',
            '--surface': '#fffaf3',
            '--border': '#f2e9e1',
            '--border2': '#dfdad9',
            '--text': '#575279',
            '--muted': '#9893a5',
            '--accent': '#286983',
            '--accent2': '#56949f',
            '--accent3': '#907aa9',
            '--danger': '#b4637a',
            '--warn': '#ea9d34',
            '--editor-bg': '#faf4ed',
            '--editor-gutter': '#fffaf3',
            '--editor-border': '#f2e9e1',
            '--editor-text': '#286983',
            '--editor-active-gutter': 'rgba(40,105,131,0.08)',
            '--editor-active-line': 'rgba(40,105,131,0.05)',
            '--editor-selection': 'rgba(86,148,159,0.2)',
            '--log-bg': '#faf4ed',
        },
    },
    {
        id: 'material-dark', label: 'Material Dark', mode: 'dark', vars: {
            '--bg': '#121212',
            '--surface': '#1e1e1e',
            '--border': '#2c2c2c',
            '--border2': '#424242',
            '--text': '#e0e0e0',
            '--muted': '#757575',
            '--accent': '#03dac6',
            '--accent2': '#82b1ff',
            '--accent3': '#bb86fc',
            '--danger': '#cf6679',
            '--warn': '#ffb74d',
            '--editor-bg': '#0e0e0e',
            '--editor-gutter': '#121212',
            '--editor-border': '#2c2c2c',
            '--editor-text': '#03dac6',
            '--editor-active-gutter': 'rgba(3,218,198,0.08)',
            '--editor-active-line': 'rgba(3,218,198,0.05)',
            '--editor-selection': 'rgba(130,177,255,0.25)',
            '--log-bg': '#0e0e0e',
        },
    },
    {
        id: 'material-light', label: 'Material Light', mode: 'light', vars: {
            '--bg': '#fafafa',
            '--surface': '#ffffff',
            '--border': '#e0e0e0',
            '--border2': '#bdbdbd',
            '--text': '#212121',
            '--muted': '#757575',
            '--accent': '#00897b',
            '--accent2': '#1976d2',
            '--accent3': '#7b1fa2',
            '--danger': '#d32f2f',
            '--warn': '#f57c00',
            '--editor-bg': '#f5f5f5',
            '--editor-gutter': '#eeeeee',
            '--editor-border': '#e0e0e0',
            '--editor-text': '#00897b',
            '--editor-active-gutter': 'rgba(0,137,123,0.08)',
            '--editor-active-line': 'rgba(0,137,123,0.05)',
            '--editor-selection': 'rgba(25,118,210,0.15)',
            '--log-bg': '#f5f5f5',
        },
    },
    {
        id: 'github-light', label: 'GitHub Light', mode: 'light', vars: {
            '--bg': '#ffffff',
            '--surface': '#f6f8fa',
            '--border': '#d0d7de',
            '--border2': '#b8c0ca',
            '--text': '#1f2328',
            '--muted': '#656d76',
            '--accent': '#1a7f37',
            '--accent2': '#0969da',
            '--accent3': '#8250df',
            '--danger': '#cf222e',
            '--warn': '#bf8700',
            '--editor-bg': '#f6f8fa',
            '--editor-gutter': '#eef1f4',
            '--editor-border': '#d0d7de',
            '--editor-text': '#1a7f37',
            '--editor-active-gutter': 'rgba(26,127,55,0.08)',
            '--editor-active-line': 'rgba(26,127,55,0.05)',
            '--editor-selection': 'rgba(9,105,218,0.15)',
            '--log-bg': '#f6f8fa',
        },
    },
    {
        id: 'github-dark', label: 'GitHub Dark', mode: 'dark', vars: {
            '--bg': '#0d1117',
            '--surface': '#161b22',
            '--border': '#21262d',
            '--border2': '#30363d',
            '--text': '#e6edf3',
            '--muted': '#7d8590',
            '--accent': '#3fb950',
            '--accent2': '#58a6ff',
            '--accent3': '#bc8cff',
            '--danger': '#f85149',
            '--warn': '#d29922',
            '--editor-bg': '#0d1117',
            '--editor-gutter': '#161b22',
            '--editor-border': '#21262d',
            '--editor-text': '#3fb950',
            '--editor-active-gutter': 'rgba(63,185,80,0.08)',
            '--editor-active-line': 'rgba(63,185,80,0.05)',
            '--editor-selection': 'rgba(88,166,255,0.25)',
            '--log-bg': '#0d1117',
        },
    },
    {
        id: 'ayu-dark', label: 'Ayu Dark', mode: 'dark', vars: {
            '--bg': '#0b0e14',
            '--surface': '#0d1017',
            '--border': '#11151c',
            '--border2': '#1c1f27',
            '--text': '#bfbdb6',
            '--muted': '#565b66',
            '--accent': '#aad94c',
            '--accent2': '#59c2ff',
            '--accent3': '#d2a6ff',
            '--danger': '#d95757',
            '--warn': '#e6b450',
            '--editor-bg': '#0b0e14',
            '--editor-gutter': '#0d1017',
            '--editor-border': '#11151c',
            '--editor-text': '#aad94c',
            '--editor-active-gutter': 'rgba(170,217,76,0.08)',
            '--editor-active-line': 'rgba(170,217,76,0.05)',
            '--editor-selection': 'rgba(89,194,255,0.25)',
            '--log-bg': '#0b0e14',
        },
    },
    {
        id: 'ayu-light', label: 'Ayu Light', mode: 'light', vars: {
            '--bg': '#fafafa',
            '--surface': '#ffffff',
            '--border': '#e7e8e9',
            '--border2': '#d8d8d7',
            '--text': '#5c6166',
            '--muted': '#8a9199',
            '--accent': '#86b300',
            '--accent2': '#399ee6',
            '--accent3': '#a37acc',
            '--danger': '#f07171',
            '--warn': '#f2ae49',
            '--editor-bg': '#fafafa',
            '--editor-gutter': '#f0f0f0',
            '--editor-border': '#e7e8e9',
            '--editor-text': '#86b300',
            '--editor-active-gutter': 'rgba(134,179,0,0.08)',
            '--editor-active-line': 'rgba(134,179,0,0.05)',
            '--editor-selection': 'rgba(57,158,230,0.15)',
            '--log-bg': '#fafafa',
        },
    },
    {
        id: 'night-owl', label: 'Night Owl', mode: 'dark', vars: {
            '--bg': '#011627',
            '--surface': '#0b2942',
            '--border': '#122d42',
            '--border2': '#1d3b53',
            '--text': '#d6deeb',
            '--muted': '#637777',
            '--accent': '#addb67',
            '--accent2': '#82aaff',
            '--accent3': '#c792ea',
            '--danger': '#ff5874',
            '--warn': '#ecc48d',
            '--editor-bg': '#011627',
            '--editor-gutter': '#0b2942',
            '--editor-border': '#122d42',
            '--editor-text': '#addb67',
            '--editor-active-gutter': 'rgba(173,219,103,0.08)',
            '--editor-active-line': 'rgba(173,219,103,0.05)',
            '--editor-selection': 'rgba(130,170,255,0.25)',
            '--log-bg': '#011627',
        },
    },
    {
        id: 'metro', label: 'Metro', mode: 'dark', vars: {
            '--bg': '#1c1c1c',
            '--surface': '#272727',
            '--border': '#333333',
            '--border2': '#444444',
            '--text': '#f2f2f2',
            '--muted': '#888888',
            '--accent': '#0078d4',
            '--accent2': '#00b7c3',
            '--accent3': '#886ce4',
            '--danger': '#e81123',
            '--warn': '#ffb900',
            '--editor-bg': '#171717',
            '--editor-gutter': '#1c1c1c',
            '--editor-border': '#333333',
            '--editor-text': '#00b7c3',
            '--editor-active-gutter': 'rgba(0,120,212,0.08)',
            '--editor-active-line': 'rgba(0,120,212,0.05)',
            '--editor-selection': 'rgba(0,183,195,0.25)',
            '--log-bg': '#171717',
        },
    },
    {
        id: 'nord-light', label: 'Nord Light', mode: 'light', vars: {
            '--bg': '#eceff4',
            '--surface': '#e5e9f0',
            '--border': '#d8dee9',
            '--border2': '#c5cdd8',
            '--text': '#2e3440',
            '--muted': '#4c566a',
            '--accent': '#a3be8c',
            '--accent2': '#5e81ac',
            '--accent3': '#b48ead',
            '--danger': '#bf616a',
            '--warn': '#ebcb8b',
            '--editor-bg': '#eceff4',
            '--editor-gutter': '#e5e9f0',
            '--editor-border': '#d8dee9',
            '--editor-text': '#a3be8c',
            '--editor-active-gutter': 'rgba(163,190,140,0.1)',
            '--editor-active-line': 'rgba(163,190,140,0.06)',
            '--editor-selection': 'rgba(94,129,172,0.2)',
            '--log-bg': '#eceff4',
        },
    },
    {
        id: 'light-owl', label: 'Light Owl', mode: 'light', vars: {
            '--bg': '#fbfbfb',
            '--surface': '#f0f0f0',
            '--border': '#d9d9d9',
            '--border2': '#c4c4c4',
            '--text': '#403f53',
            '--muted': '#989fb1',
            '--accent': '#2aa298',
            '--accent2': '#4876d6',
            '--accent3': '#994cc3',
            '--danger': '#de3d3b',
            '--warn': '#daaa01',
            '--editor-bg': '#fbfbfb',
            '--editor-gutter': '#f0f0f0',
            '--editor-border': '#d9d9d9',
            '--editor-text': '#2aa298',
            '--editor-active-gutter': 'rgba(42,162,152,0.08)',
            '--editor-active-line': 'rgba(42,162,152,0.05)',
            '--editor-selection': 'rgba(72,118,214,0.15)',
            '--log-bg': '#fbfbfb',
        },
    },
    {
        id: 'one-light', label: 'One Light', mode: 'light', vars: {
            '--bg': '#fafafa',
            '--surface': '#eaeaeb',
            '--border': '#dbdbdc',
            '--border2': '#c8c8c9',
            '--text': '#383a42',
            '--muted': '#a0a1a7',
            '--accent': '#50a14f',
            '--accent2': '#4078f2',
            '--accent3': '#a626a4',
            '--danger': '#e45649',
            '--warn': '#c18401',
            '--editor-bg': '#fafafa',
            '--editor-gutter': '#eaeaeb',
            '--editor-border': '#dbdbdc',
            '--editor-text': '#50a14f',
            '--editor-active-gutter': 'rgba(80,161,79,0.08)',
            '--editor-active-line': 'rgba(80,161,79,0.05)',
            '--editor-selection': 'rgba(64,120,242,0.15)',
            '--log-bg': '#fafafa',
        },
    },
    {
        id: 'tokyo-night-day', label: 'Tokyo Night Day', mode: 'light', vars: {
            '--bg': '#e1e2e7',
            '--surface': '#eef0f5',
            '--border': '#c4c8da',
            '--border2': '#b4b8ca',
            '--text': '#343b58',
            '--muted': '#8990b3',
            '--accent': '#587539',
            '--accent2': '#2e7de9',
            '--accent3': '#9854f1',
            '--danger': '#8c4351',
            '--warn': '#8f5e15',
            '--editor-bg': '#e1e2e7',
            '--editor-gutter': '#eef0f5',
            '--editor-border': '#c4c8da',
            '--editor-text': '#587539',
            '--editor-active-gutter': 'rgba(88,117,57,0.08)',
            '--editor-active-line': 'rgba(88,117,57,0.05)',
            '--editor-selection': 'rgba(46,125,233,0.15)',
            '--log-bg': '#e1e2e7',
        },
    },
];

function themeVars(theme) {
    return Object.entries(theme.vars).map(([key, value]) => `${key}: ${value};`).join('\n    ');
}

// Every variable a theme must define, for anything (custom theme apply
// logic, validation) that needs the canonical set without duplicating it.
export const THEME_VAR_KEYS = Object.keys(THEME_LIST[0].vars);

// Every palette's variables are scoped behind [data-palette="id"] on <html>
// (set by ThemePicker), so any number of themes can coexist. The plain
// :root block underneath is just a pre-JS fallback matching the default
// dark theme.
const paletteBlocks = THEME_LIST.map(t => `
  :root[data-palette="${t.id}"] {
    ${themeVars(t)}
  }
`).join('');

export const css = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    ${themeVars(THEME_LIST[0])}
    --mono: 'IBM Plex Mono', monospace;
    --sans: 'IBM Plex Sans', sans-serif;
    color-scheme: dark;
  }
  :root.light {
    color-scheme: light;
  }
  ${paletteBlocks}

  html, body { height: 100%; height: 100dvh; overflow: hidden; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 14px;
    line-height: 1.6;
    transition: background 0.2s, color 0.2s;
  }

  .shell { display: flex; height: 100vh; height: 100dvh; overflow: hidden; }

  .sidebar {
    width: 220px;
    flex-shrink: 0;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 0;
    transition: transform 0.2s ease, background 0.2s;
    z-index: 200;
  }

  .sidebar-logo {
    padding: 20px 20px 16px;
    border-bottom: 1px solid var(--border);
  }

  .logo-mark {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 18px;
    font-weight: 600;
    color: var(--accent);
    letter-spacing: -0.5px;
  }

  .logo-sub {
    font-size: 10px;
    color: var(--muted);
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-top: 2px;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    margin-top: 8px;
  }

  .status-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--muted);
  }
  .status-dot.online { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
  .status-dot.offline { background: var(--danger); }

  .status-pill-text { color: var(--muted); }

  .status-refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin-left: 2px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
  }
  .status-refresh:hover { color: var(--text); background: rgba(255,255,255,0.06); }

  .instance-dropdown {
    position: relative;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
  }

  .instance-dropdown-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border: 1px solid var(--border2);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .instance-dropdown-trigger:hover { border-color: var(--accent); }

  .instance-dropdown-name {
    font-family: var(--mono);
    font-size: 11px;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }

  .instance-dropdown-chevron {
    font-size: 10px;
    color: var(--muted);
    transition: transform 0.15s;
  }
  .instance-dropdown-chevron.open { transform: rotate(180deg); }

  .instance-dropdown-menu {
    position: absolute;
    left: 16px;
    right: 16px;
    top: calc(100% - 2px);
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    z-index: 100;
    overflow: hidden;
  }

  .instance-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    font-size: 12px;
    color: var(--muted);
    transition: all 0.15s;
  }

  .instance-dropdown-item:hover { color: var(--text); background: rgba(255,255,255,0.04); }

  .instance-dropdown-item.active {
    color: var(--accent);
    background: rgba(0,229,160,0.07);
  }

  .instance-name {
    font-family: var(--mono);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .instance-details-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px 24px;
  }

  .instance-form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 16px;
  }

  .nav { padding: 12px 0; flex: 1; }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 20px;
    cursor: pointer;
    color: var(--muted);
    font-size: 13px;
    font-weight: 400;
    border-left: 2px solid transparent;
    transition: all 0.15s;
    user-select: none;
  }

  .nav-item:hover { color: var(--text); background: rgba(0,0,0,0.04); }

  .nav-item.active {
    color: var(--accent);
    border-left-color: var(--accent);
    background: rgba(0,149,107,0.07);
  }

  .nav-icon { width: 16px; text-align: center; font-size: 14px; flex-shrink: 0; }

  .nav-footer {
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }

  .sidebar-version {
    padding: 8px 20px 0;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--muted);
    letter-spacing: 0.5px;
  }

  .main {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .topbar {
    padding: 14px 28px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--surface);
    flex-shrink: 0;
    gap: 12px;
    transition: background 0.2s;
  }

  .topbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .page-title {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    letter-spacing: 0.5px;
    white-space: nowrap;
  }

  .hamburger {
    display: none;
    background: transparent;
    border: 1px solid var(--border2);
    border-radius: 4px;
    color: var(--muted);
    cursor: pointer;
    padding: 6px 8px;
    font-size: 14px;
    flex-shrink: 0;
    line-height: 1;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 28px;
  }

  .sidebar-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    z-index: 150;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 20px;
    transition: background 0.2s;
  }

  .card-title {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 16px;
  }

  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .gap-16 { display: flex; flex-direction: column; gap: 16px; }

  .stat-val {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 32px;
    font-weight: 600;
    color: var(--text);
    line-height: 1;
  }

  .stat-label {
    font-size: 12px;
    color: var(--muted);
    margin-top: 4px;
  }

  .server-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
    gap: 8px;
  }
  .server-row:last-child { border-bottom: none; }

  .server-name {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: var(--text);
  }

  .server-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }

  .badge {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 3px;
    font-weight: 500;
    white-space: nowrap;
  }
  .badge-green  { background: rgba(0,149,107,0.1);  color: var(--accent);  border: 1px solid rgba(0,149,107,0.25); }
  .badge-blue   { background: rgba(0,119,204,0.1);  color: var(--accent2); border: 1px solid rgba(0,119,204,0.25); }
  .badge-red    { background: rgba(204,34,51,0.1);  color: var(--danger);  border: 1px solid rgba(204,34,51,0.25); }
  .badge-yellow { background: rgba(179,96,0,0.1);   color: var(--warn);    border: 1px solid rgba(179,96,0,0.25); }
  .badge-muted  { background: rgba(138,127,117,0.1);color: var(--muted);   border: 1px solid rgba(138,127,117,0.25); }

  .server-edit-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    margin: -4px;
    border-radius: 4px;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
  }
  .server-edit-icon:hover { color: var(--text); background: rgba(255,255,255,0.06); }

  .editor-wrap {
    position: relative;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .editor-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--editor-bg);
    border-top: 1px solid var(--border);
    flex-wrap: wrap;
    gap: 8px;
  }

  .editor-hint { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--muted); }
  .editor-hint--mobile { display: none; }

  .tls-ca-actions { flex-shrink: 0; }
  .btn.tls-refresh--mobile { display: none; }

  .cm-editor { min-height: 420px; font-family: 'IBM Plex Mono', monospace !important; }
  .cm-editor.cm-focused { outline: none; }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: 4px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.15s;
    letter-spacing: 0.3px;
    white-space: nowrap;
  }

  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
  .btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border2); }
  .btn-ghost:hover:not(:disabled) { color: var(--text); border-color: var(--muted); }
  .btn-danger { background: transparent; color: var(--danger); border: 1px solid rgba(204,34,51,0.3); }
  .btn-danger:hover:not(:disabled) { background: rgba(204,34,51,0.08); }

  .btn-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

  .theme-picker { position: relative; display: flex; flex-shrink: 0; }

  .theme-toggle {
    background: transparent;
    border: 1px solid var(--border2);
    border-right: none;
    border-radius: 4px 0 0 4px;
    color: var(--muted);
    cursor: pointer;
    padding: 6px 10px;
    font-size: 14px;
    line-height: 1;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .theme-toggle:hover { color: var(--text); border-color: var(--muted); }

  .theme-picker-trigger {
    background: transparent;
    border: 1px solid var(--border2);
    border-radius: 0 4px 4px 0;
    color: var(--muted);
    cursor: pointer;
    padding: 6px 6px;
    font-size: 10px;
    line-height: 1;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .theme-picker-trigger:hover { color: var(--text); border-color: var(--muted); }

  .theme-picker-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 200px;
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    z-index: 100;
    padding: 12px;
  }

  .theme-picker-row { margin-bottom: 10px; }
  .theme-picker-row:last-child { margin-bottom: 0; }
  .theme-picker-row label {
    display: block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
  }

  .toast-wrap {
    position: fixed;
    top: 12px; right: 19px;
    display: flex; flex-direction: column;
    gap: 8px; z-index: 1000;
    max-width: calc(100vw - 48px);
  }

  .toast {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    padding: 10px 16px;
    border-radius: 4px;
    border-left: 3px solid;
    animation: slideIn 0.2s ease;
    max-width: 340px;
  }

  .toast-success { background: rgba(0,149,107,0.12); border-color: var(--accent); color: var(--accent); }
  .toast-error   { background: rgba(204,34,51,0.12);  border-color: var(--danger); color: var(--danger); }
  .toast-info    { background: rgba(0,119,204,0.12);  border-color: var(--accent2); color: var(--accent2); }

  @keyframes slideIn {
    from { transform: translateX(20px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }

  .table-wrap { overflow-x: auto; }

  .table { width: 100%; border-collapse: collapse; min-width: 500px; }
  .table th {
    text-align: left;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--muted);
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .table td {
    padding: 11px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
    vertical-align: middle;
  }
  .table tr:last-child td { border-bottom: none; }
  .table tr:hover td { background: rgba(0,0,0,0.03); }

  .mono { font-family: 'IBM Plex Mono', monospace; font-size: 12px; }

  a.route-link {
    color: inherit;
    text-decoration: none;
    border-bottom: 1px dashed var(--border2);
    transition: color 0.15s, border-color 0.15s;
  }
  a.route-link:hover { color: var(--accent) !important; border-color: var(--accent); }
  a.route-link.upstream { color: var(--accent2); }

  .search-input {
    background: var(--editor-bg);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 7px 12px;
    color: var(--text);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    outline: none;
    width: 380px;
    transition: border-color 0.15s;
  }
  .search-input--clearable { padding-right: 28px; }
  .search-input:focus { border-color: var(--accent); }
  .search-input::placeholder { color: var(--muted); }

  .search-wrap { position: relative; }
  .search-clear {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 4px;
    line-height: 1;
    border-radius: 2px;
  }
  .search-clear:hover { color: var(--text); }

  .col-picker { position: relative; }

  .col-picker-trigger { position: relative; }

  .col-picker-badge {
    position: absolute;
    top: -3px;
    right: -3px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--bg);
  }

  .col-picker-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 140px;
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    z-index: 100;
    padding: 6px;
  }

  .col-picker-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
  }
  .col-picker-item:hover { background: rgba(255,255,255,0.04); }
  .col-picker-item input { cursor: pointer; }

  .col-picker-note {
    padding: 8px 8px 2px;
    font-size: 10px;
    color: var(--muted);
    border-top: 1px solid var(--border);
    margin-top: 4px;
  }

  .server-cell--filterable { cursor: pointer; }
  .server-cell--filterable:hover { color: var(--accent); }

  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center;
    z-index: 500;
    animation: fadeIn 0.15s ease;
    padding: 16px;
  }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .modal {
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: 8px;
    padding: 24px;
    width: 460px;
    max-width: 100%;
  }

  .modal-title {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 20px;
  }

  .modal--confirm { width: 380px; }
  .modal--confirm .modal-title { font-weight: 400; line-height: 1.5; }

  .field { margin-bottom: 14px; }
  .field label {
    display: block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .field input {
    width: 100%;
    background: var(--editor-bg);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 8px 12px;
    color: var(--text);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
  }
  .field input:focus { border-color: var(--accent); }
  .field input:disabled { opacity: 0.4; cursor: not-allowed; }

  .logs-page { height: 100%; }

  .log-wrap {
    background: var(--log-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    flex: 1;
    min-height: 300px;
    overflow-y: auto;
    padding: 12px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    line-height: 1.6;
  }

  .log-line { padding: 1px 0; color: var(--muted); word-break: break-all; }
  .log-line:hover { color: var(--text); background: rgba(0,0,0,0.04); }
  .log-line.err { color: var(--danger); }
  .log-line.warn { color: var(--warn); }
  .log-line.info { color: var(--accent2); }
  .log-line.err:hover,
  .log-line.warn:hover,
  .log-line.info:hover {
    background: rgba(0,0,0,0.04);
    filter: brightness(1.35);
  }
  .log-line.highlight { background: rgba(0,149,107,0.08); color: var(--text); }

  .log-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .live-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  .expiry-bar {
    height: 3px;
    border-radius: 2px;
    background: var(--border);
    margin-top: 4px;
    overflow: hidden;
    width: 80px;
  }
  .expiry-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s;
  }

  .history-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 0;
    border-bottom: 1px solid var(--border);
    gap: 8px;
  }
  .history-row:last-child { border-bottom: none; }
  .history-row:hover { background: rgba(0,0,0,0.03); }

  .history-preview {
    background: var(--editor-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 12px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--editor-text);
    line-height: 1.6;
    max-height: 200px;
    overflow-y: auto;
    overflow-x: auto;
    margin-top: 12px;
    white-space: pre;
  }

  .metrics-bar-wrap { display: flex; flex-direction: column; gap: 8px; }
  .metrics-bar-row { display: flex; align-items: center; gap: 10px; }
  .metrics-bar-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); width: 32px; flex-shrink: 0; }
  .metrics-bar-track { flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
  .metrics-bar-fill { height: 100%; border-radius: 4px; transition: width 0.4s ease; }
  .metrics-bar-count { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text); width: 40px; text-align: right; flex-shrink: 0; }

  .login-shell {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    height: 100dvh;
    background: var(--bg);
  }

  .login-card {
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: 8px;
    padding: 40px;
    width: 360px;
    max-width: calc(100vw - 32px);
  }

  .login-logo {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 24px;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 4px;
  }

  .login-sub {
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 32px;
  }

  .login-error {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--danger);
    margin-bottom: 12px;
    padding: 8px 12px;
    background: rgba(204,34,51,0.08);
    border: 1px solid rgba(204,34,51,0.2);
    border-radius: 4px;
  }

  /* ── Utility: Loading states ─────────────────────────────────────────────── */

  .loading {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: var(--muted);
  }

  /* ── Utility: Typography ──────────────────────────────────────────────────── */

  .section-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--muted);
  }

  .field-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 4px;
    display: block;
  }

  .metrics-status-text {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    font-weight: 500;
    flex-shrink: 0;
  }

  .hint {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--muted);
    margin-bottom: 16px;
  }

  .data-val {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    color: var(--text);
  }

  .data-val--accent { color: var(--accent); }
  .data-val--danger { color: var(--danger); }
  .data-val--muted  { color: var(--muted); font-size: 11px; }

  /* ── Utility: Card variants ───────────────────────────────────────────────── */

  .card-clickable { cursor: pointer; }
  .card-clickable:hover { border-color: var(--border2); }

  .card-danger { border-color: rgba(204,34,51,0.3); }
  .card-danger .card-title { color: var(--danger); }

  .card-flush { padding: 0; overflow: hidden; }

  .card-header {
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
  }

  .card-header--clickable {
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    user-select: none;
  }

  .card-header--clickable.is-open { border-bottom: 1px solid var(--border); }

  .card-body { padding: 16px; }

  .card-empty {
    padding: 24px;
    text-align: center;
    color: var(--muted);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
  }

  /* ── Utility: Modal ───────────────────────────────────────────────────────── */

  .modal-hint {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--muted);
    margin-bottom: 16px;
  }

  .modal-badges {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }

  .modal-section-divider {
    border-top: 1px solid var(--border);
    margin: 4px 0 20px;
  }

  .modal-section-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 12px;
  }

  /* ── Utility: Table ───────────────────────────────────────────────────────── */

  .th-sortable { cursor: pointer; user-select: none; }

  .sort-icon { opacity: 0.3; margin-left: 4px; }
  .sort-icon--active { margin-left: 4px; color: var(--accent); }

  .col-actions { width: 100px; text-align: right; }
  .col-actions-sm { width: 60px; text-align: right; }

  .cell-muted { color: var(--muted); font-size: 10px; }

  /* ── Utility: Buttons ─────────────────────────────────────────────────────── */

  .btn--icon { padding: 4px 10px; }
  .btn--sm   { padding: 3px 10px; font-size: 11px; }
  .btn--full { width: 100%; justify-content: center; margin-top: 8px; }
  .btn--right { margin-left: auto; }

  /* ── Utility: Layout ──────────────────────────────────────────────────────── */

  .flex-between {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .flex-center {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .flex-end {
    display: flex;
    justify-content: flex-end;
  }

  .flex-col-sm {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .process-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 16px;
  }

  .inline-muted {
    color: var(--muted);
    font-size: 11px;
    margin-left: 4px;
  }

  /* ── Utility: Caddyfile-managed route notice ──────────────────────────────── */

  .modal-editor-wrap {
    border-radius: 4px;
    overflow: hidden;
  }

  .modal-editor-wrap .cm-editor { min-height: 180px; max-height: 340px; font-family: 'IBM Plex Mono', monospace !important; }
  .modal-editor-wrap .cm-editor.cm-focused { outline: none; }
  .modal-editor-wrap .cm-scroller { max-height: 340px; }

  .caddyfile-notice {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    background: rgba(0,0,0,0.15);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 12px;
    margin-bottom: 8px;
  }

  /* ── Utility: Metrics ─────────────────────────────────────────────────────── */

  .metrics-footer {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--muted);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .metrics-footer-label {
    letter-spacing: 1px;
    text-transform: uppercase;
    font-size: 10px;
  }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  .percentile-rows { display: flex; flex-direction: column; gap: 14px; }
  .percentile-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .percentile-bar-track { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .percentile-bar-fill { height: 100%; border-radius: 2px; transition: width 0.4s; }
  .percentile-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); }
  .percentile-val { font-family: 'IBM Plex Mono', monospace; font-size: 13px; }
  .percentile-unit { font-size: 10px; color: var(--muted); margin-left: 3px; }
  .ms-unit { font-size: 14px; color: var(--muted); margin-left: 4px; }

  /* ── Utility: Log config form elements ───────────────────────────────────── */

  .config-select, .config-input {
    background: var(--editor-bg);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 6px 10px;
    color: var(--text);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    outline: none;
    width: 100%;
  }

  .config-section-divider { border-top: 1px solid var(--border); padding-top: 16px; }

  .config-select {
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    padding-right: 28px;
  }
  .config-select:disabled, .config-input:disabled { opacity: 0.4; cursor: not-allowed; }

  /* Plain-text chevron instead of a background-image SVG -- some browser
     dark-mode extensions (e.g. Dark Reader-style forced-dark tooling) treat
     any element with a background-image as "media" to re-invert, which
     was corrupting the select into a garbled dither pattern. */
  .select-wrap { position: relative; }
  .select-wrap .config-select { width: 100%; }
  .select-arrow {
    position: absolute;
    top: 50%;
    right: 10px;
    transform: translateY(-50%);
    pointer-events: none;
    color: var(--muted);
    font-size: 10px;
    line-height: 1;
  }

  .config-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 16px;
    margin-bottom: 16px;
  }

  .config-grid-full { grid-column: 1 / -1; }

  .config-checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: var(--text);
  }

  .config-checkbox { accent-color: var(--accent); width: 14px; height: 14px; }

  .log-empty {
    color: var(--muted);
    padding: 8px 0;
  }

  /* ── Utility: Health dot ──────────────────────────────────────────────────── */

  .health-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .health-dot--none    { background: var(--border2); }
  .health-dot--pending { background: var(--muted); }

  .col-status { width: 1%; white-space: nowrap; }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .route-note--mobile {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--muted);
    margin-top: 2px;
    display: none;
  }
  .col-title { font-size: 12px; }

  .route-domain-cell { display: flex; align-items: center; gap: 8px; }

  .route-domain-sep { color: var(--muted); }

  /* ── Utility: Server name display ─────────────────────────────────────────── */

  .server-display-name {
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 12px;
    color: var(--text);
  }

  .server-separator {
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 12px;
    color: var(--muted);
  }

  .server-row--clickable { cursor: pointer; }

  .chevron { color: var(--muted); font-size: 12px; }

  /* ── Utility: Log toolbar ─────────────────────────────────────────────────── */

  .log-line-count {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--muted);
  }
  .log-line-count--mobile { display: none; }

  .btn.btn-ghost.level-btn--error.is-active, .btn.btn-ghost.level-btn--error:hover { border-color: var(--danger); color: var(--danger); }
  .btn.btn-ghost.level-btn--warn.is-active,  .btn.btn-ghost.level-btn--warn:hover  { border-color: var(--warn);   color: var(--warn); }
  .btn.btn-ghost.level-btn--info.is-active,  .btn.btn-ghost.level-btn--info:hover  { border-color: var(--accent2); color: var(--accent2); }

  /* ── Utility: Editor toolbar ──────────────────────────────────────────────── */

  .editor-checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    cursor: pointer;
  }

  .editor-checkbox { accent-color: var(--accent); }

  /* ── Utility: History entry ───────────────────────────────────────────────── */

  .history-entry {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    cursor: pointer;
    flex: 1;
  }

  .history-entry--active { color: var(--accent); }
  .history-entry--default { color: var(--text); }

  .history-body { padding: 0 16px; }

  /* ── Utility: History ─────────────────────────────────────────────────────── */

  .history-latest {
    margin-left: 8px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--muted);
  }

  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

  @media (max-width: 768px) {
    .hamburger { display: flex; }
    .sidebar {
      position: fixed;
      top: 0; left: 0; bottom: 0;
      transform: translateX(-100%);
    }
    .sidebar.open { transform: translateX(0); box-shadow: 4px 0 24px rgba(0,0,0,0.4); }
    .sidebar-overlay.open { display: block; }
    .content { padding: 16px; padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
    .topbar { padding: 12px 16px; }
    .grid-4 { grid-template-columns: 1fr 1fr; }
    .grid-3 { grid-template-columns: 1fr; }
    .grid-2 { grid-template-columns: 1fr; }
    .metrics-footer { flex-direction: column; align-items: flex-start; gap: 8px; }
    .cm-editor { min-height: 300px; }
    .cm-editor .cm-content { font-size: 16px; }
    .modal-editor-wrap .cm-editor { min-height: 160px; max-height: 260px; }
    .modal-editor-wrap .cm-scroller { max-height: 260px; }
    .editor-toolbar { flex-direction: column; align-items: stretch; }
    .editor-hint--desktop { display: none; }
    .editor-hint--mobile { display: inline; margin-left: auto; }
    .editor-toolbar-actions .btn { flex: 1 1 90px; }
    .log-wrap { flex: none; height: 340px; min-height: 0; }
    .search-wrap { width: 100%; }
    .search-input { width: 100%; }
    .log-toolbar { flex-direction: column; align-items: stretch; }
    .log-toolbar .btn-row { width: 100%; }
    .log-save-btn { width: 100%; justify-content: center; }
    .log-line-count--desktop { display: none; }
    .log-line-count--mobile { display: inline; margin-left: auto; }
    .col-title { display: none; }
    .route-note--mobile { display: block; }
    .routes-toolbar { flex-direction: column; align-items: stretch; }
    .routes-toolbar .flex-center { width: 100%; }
    .routes-toolbar-actions .btn-ghost { flex: 1 1 0; }
    .routes-toolbar-actions .btn-primary { flex: 2 1 0; }
    .btn.tls-refresh--desktop { display: none; }
    .btn.tls-refresh--mobile { display: inline-flex; }
    .tls-ca-actions { flex: 1 1 100%; }
    .tls-ca-actions .btn-ghost { flex: 1 1 0; }
    .tls-ca-actions .btn-primary { flex: 2 1 0; }
    .log-config-enabled { grid-column: 1 / -1; }
    .log-enabled-btn { width: 100%; justify-content: center; }
    .metrics-toggle-btn { flex: 1 1 100%; justify-content: center; }
    .metrics-status-text { display: block; width: 100%; margin-top: 8px; }
    .notifications-enabled-btn { width: 100%; justify-content: center; }
    .instance-details-grid { grid-template-columns: 1fr; }
    .instance-form-grid { grid-template-columns: 1fr; }
    .notif-test-btn { order: 1; flex: 1 1 0; justify-content: center; }
    .notif-save-btn { order: 2; flex: 2 1 0; justify-content: center; }

    /* iOS Safari zooms the page in on focus when a field's font-size is under
       16px; bump these to 16px on mobile so focusing them doesn't zoom. */
    .search-input,
    .field input,
    .config-select,
    .config-input {
      font-size: 16px;
    }
  }
`;

import { DEFAULT_PALETTES } from './styles.js';

// What the UI shows until the backend's settings arrive.
export const DEFAULT_SETTINGS = {
    theme: 'dark',
    language: null,
    editorVim: false,
    darkPalette: DEFAULT_PALETTES.dark,
    lightPalette: DEFAULT_PALETTES.light,
    routeColumns: { status: true, title: true, upstream: true, server: true, id: true },
    routeChecks: false,
    routeCheckExcludes: [],
};

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

// A new instance's paths: where a stock Caddy container keeps things.
export const INSTANCE_DEFAULTS = {
    configPath: '/etc/caddy/Caddyfile',
    logPath: '/var/log/caddy/access.log',
    dataPath: '/data/caddy',
    serverName: 'srv0',
};

// What an API token can be allowed to read, and each one's label.
export const API_TOKEN_SCOPE_KEYS = { 'status:read': 'apiTokens.status', 'metrics:read': 'apiTokens.metrics' };

// Where notifications can be sent, in menu order.
export const NOTIFICATION_PROVIDERS = ['ntfy', 'discord', 'slack', 'pushover', 'custom'];

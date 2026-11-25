import { ApiError } from './api.js';

export const SOURCES = {
    caddy: { path: '/logs', filename: 'caddy-access' },
    app: { path: '/logs/app', filename: 'caddy-ui' },
};

// How each level is styled in the log view
export const LEVEL_CLASSES = { error: 'err', warn: 'warn', info: 'info' };

// The level of a line: the one it records as JSON or in Caddy's console format,
// otherwise what its text suggests.
export function lineLevel(line) {
    const recorded = /"level":"(\w+)"/.exec(line) || /\t([A-Z]+)\t/.exec(line);
    if (recorded) return recorded[1].toLowerCase();
    return /error/i.test(line) ? 'error' : /warn/i.test(line) ? 'warn' : null;
}

// Link destinations use the same IDs as the log source selector.
export function resolveLogSource(search, noInstances = false) {
    if (noInstances) return 'app';
    return new URLSearchParams(search).get('dist') === 'app' ? 'app' : 'caddy';
}

export function readLogResponse(data, source) {
    // Older backends return HTTP 200 for failed file reads. Keep that response
    // distinguishable from a successful read of an empty file during upgrades.
    if (source === 'caddy' && data?.error) {
        // eslint-disable-next-line i18next/no-literal-string -- Protocol code; displayed through localizeError.
        throw new ApiError('', { code: data.code || 'LOG_READ_FAILED', requestId: data.requestId });
    }
    const entries = source === 'caddy' ? data?.lines : data?.entries;
    if (!Array.isArray(entries) || (source === 'caddy' && entries.some(line => typeof line !== 'string'))) {
        // eslint-disable-next-line i18next/no-literal-string -- Protocol code; displayed through localizeError.
        throw new ApiError('', { code: 'CLIENT_PARSE_FAILED' });
    }
    return source === 'caddy' ? entries : entries.map(entry => JSON.stringify(entry));
}

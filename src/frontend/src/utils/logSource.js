import { ApiError } from './api.js';

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

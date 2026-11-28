import { isIP } from 'node:net';

const INVALID = 'CADDY_UI_EXTERNAL_URL must be comma-separated HTTP(S) URLs without credentials';

// The addresses browsers reach caddy-ui at: CADDY_UI_EXTERNAL_URL, a
// comma-separated list. An empty or missing value means none are configured;
// an invalid one throws, which stops startup.
export function parseExternalUrls(value) {
    return (value || '').split(',').map(entry => entry.trim()).filter(Boolean).map(entry => {
        let url;
        try {
            url = new URL(entry);
        } catch {
            throw new TypeError(INVALID);
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            throw new TypeError(INVALID);
        }
        return url;
    });
}

// Secure cookies would be dropped on any plain HTTP address.
export function servesOnlyHttps(urls) {
    return urls.length > 0 && urls.every(url => url.protocol === 'https:');
}

export function isIpAddress(url) {
    return isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0;
}

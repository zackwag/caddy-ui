export const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || 'http://caddy:2019';

const HEADERS = {
    'Content-Type': 'application/json',
    'Origin': 'http://0.0.0.0:2019',
};

async function caddyRequest(method, path, body) {
    const res = await fetch(`${CADDY_ADMIN_URL}${path}`, {
        method,
        headers: HEADERS,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Caddy API error: ${res.status} ${text}`);
    }
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
}

export const caddyGet = (path) => caddyRequest('GET', path);
export const caddyPut = (path, body) => caddyRequest('PUT', path, body);
export const caddyPost = (path, body) => caddyRequest('POST', path, body);
export const caddyPatch = (path, body) => caddyRequest('PATCH', path, body);
export const caddyDelete = (path) => caddyRequest('DELETE', path);

export async function caddyLoad(caddyfileContent) {
    const res = await fetch(`${CADDY_ADMIN_URL}/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/caddyfile', 'Origin': 'http://0.0.0.0:2019' },
        body: caddyfileContent,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Caddy reload failed: ${text}`);
    }
}

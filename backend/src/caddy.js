const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || 'http://caddy:2019';

const BASE_HEADERS = {
    'Origin': 'http://0.0.0.0:2019',
};

export async function caddyGet(path) {
    const res = await fetch(`${CADDY_ADMIN_URL}${path}`, {
        headers: BASE_HEADERS,
    });
    if (!res.ok) throw new Error(`Caddy API error: ${res.status} ${await res.text()}`);
    return res.json();
}

export async function caddyPost(path, body) {
    const res = await fetch(`${CADDY_ADMIN_URL}${path}`, {
        method: 'POST',
        headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Caddy API error: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
}

export async function caddyPut(path, body) {
    const res = await fetch(`${CADDY_ADMIN_URL}${path}`, {
        method: 'PUT',
        headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Caddy API error: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
}

export async function caddyPatch(path, body) {
    const res = await fetch(`${CADDY_ADMIN_URL}${path}`, {
        method: 'PATCH',
        headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Caddy API error: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
}

export async function caddyDelete(path) {
    const res = await fetch(`${CADDY_ADMIN_URL}${path}`, {
        method: 'DELETE',
        headers: BASE_HEADERS,
    });
    if (!res.ok) throw new Error(`Caddy API error: ${res.status} ${await res.text()}`);
    return {};
}

export async function caddyLoad(caddyfileText) {
    const res = await fetch(`${CADDY_ADMIN_URL}/load`, {
        method: 'POST',
        headers: { ...BASE_HEADERS, 'Content-Type': 'text/caddyfile' },
        body: caddyfileText,
    });
    if (!res.ok) throw new Error(`Caddy reload error: ${res.status} ${await res.text()}`);
    return {};
}

export { CADDY_ADMIN_URL };

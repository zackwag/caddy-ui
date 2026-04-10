export const API = "/api";

export function getToken() { return localStorage.getItem('caddy_ui_token'); }
export function setToken(token) {
    if (token) localStorage.setItem('caddy_ui_token', token);
    else localStorage.removeItem('caddy_ui_token');
}

export function getTheme() { return localStorage.getItem('caddy_ui_theme') || 'dark'; }
export function saveTheme(theme) { localStorage.setItem('caddy_ui_theme', theme); }

export async function apiFetch(path, opts = {}, onUnauth) {
    const token = getToken();
    const headers = { ...(opts.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API}${path}`, { ...opts, headers });
    if (res.status === 401) {
        setToken(null);
        if (onUnauth) onUnauth();
        throw new Error('Session expired — please log in again');
    }
    if (!res.ok) {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
            const body = await res.json();
            if (body.errors?.length) throw new Error(body.errors.join('\n'));
            throw new Error(body.error || res.statusText);
        }
        throw new Error(res.statusText);
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
}

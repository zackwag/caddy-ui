/* eslint-disable i18next/no-literal-string -- Internal API protocol identifiers, error codes, and diagnostics are not localized UI copy */

export const API = "/api";

export class ApiError extends Error {
    constructor(message, { code = 'REQUEST_FAILED', requestId = null, status = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.requestId = requestId;
        this.status = status;
    }
}

export function getToken() { return localStorage.getItem('caddy_ui_token'); }
export function setToken(token) {
    if (token) localStorage.setItem('caddy_ui_token', token);
    else localStorage.removeItem('caddy_ui_token');
}

export function getAuthEnabled() {
    const v = localStorage.getItem('caddy_ui_auth_enabled');
    return v === null ? null : v === 'true';
}
export function setAuthEnabled(v) { localStorage.setItem('caddy_ui_auth_enabled', String(v)); }

export async function fetchSettings(onUnauth) {
    return apiFetch('/settings', {}, onUnauth);
}

export async function saveSettings(updates, onUnauth) {
    return apiFetch('/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    }, onUnauth);
}

// Themes found under THEMES_PATH at startup -- read-only, managed as files.
export async function fetchCustomThemes(onUnauth) {
    return apiFetch('/custom-themes', {}, onUnauth);
}

export function getInstanceId() { return localStorage.getItem('caddy_ui_instance') || 'default'; }
export function setInstanceId(id) { localStorage.setItem('caddy_ui_instance', id); }

// The app shell subscribes so views remount on the backend's fallback instance
// once a deleted or unknown selection has been dropped.
const instanceResetListeners = new Set();
export function onInstanceSelectionReset(listener) {
    instanceResetListeners.add(listener);
    return () => instanceResetListeners.delete(listener);
}
export function clearInstanceId() {
    localStorage.removeItem('caddy_ui_instance');
    for (const listener of instanceResetListeners) listener();
}

export async function apiFetch(path, opts = {}, onUnauth) {
    const token = getToken();
    const headers = { ...(opts.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const instanceId = getInstanceId();
    headers['X-Instance-Id'] = instanceId;
    let res;
    try {
        res = await fetch(`${API}${path}`, { ...opts, headers });
    } catch (cause) {
        // No server received this request; keep browser-only details in console.
        console.error('API connection failed', { path, cause });
        throw new ApiError('Network connection failed', { code: 'NETWORK_ERROR' });
    }
    const ct = res.headers.get('content-type') || '';
    let body;
    try {
        body = ct.includes('application/json') ? await res.json() : await res.text();
    } catch {
        body = null;
    }
    if (res.status === 401) {
        setToken(null);
        if (onUnauth) onUnauth();
    }
    if (!res.ok) {
        const payload = body && typeof body === 'object' ? body : {};
        // Never retried: the request may be a write meant for the missing instance.
        // Skip the reset if the user already switched while this was in flight.
        if (payload.code === 'INSTANCE_SELECTION_INVALID' && getInstanceId() === instanceId) clearInstanceId();
        throw new ApiError(
            payload.errors?.join('\n') || payload.error || res.statusText,
            { code: payload.code || (res.status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED'),
              requestId: payload.requestId || res.headers.get('X-Request-ID'), status: res.status },
        );
    }
    return body;
}

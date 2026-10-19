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

let csrfRequest;
export function resetAuthContext() {
    csrfRequest = undefined;
    // Remove credentials left by versions that used browser storage.
    localStorage.removeItem('caddy_ui_token');
    localStorage.removeItem('caddy_ui_auth_enabled');
}

async function csrfToken() {
    if (!csrfRequest) {
        csrfRequest = fetch(`${API}/auth/csrf`, { credentials: 'same-origin', cache: 'no-store' })
            .then(async response => {
                const body = await response.json();
                if (!response.ok || typeof body.csrfToken !== 'string') throw new ApiError('Cannot establish request context', { code: 'CSRF_INVALID' });
                return body.csrfToken;
            }).catch(error => {
                csrfRequest = undefined;
                if (error instanceof ApiError) throw error;
                throw new ApiError('Network connection failed', { code: 'NETWORK_ERROR' });
            });
    }
    return csrfRequest;
}

export async function authRequest(path, opts = {}, onUnauth) {
    try { return await apiFetch('/auth' + path, opts, onUnauth); }
    finally { csrfRequest = undefined; }
}

export async function fetchAuthStatus() {
    const state = await apiFetch('/auth/status', { cache: 'no-store' });
    if (typeof state?.authEnabled !== 'boolean' || typeof state?.authenticated !== 'boolean') {
        throw new ApiError('Invalid authentication response', { code: 'INVALID_LOCAL_STATE' });
    }
    return state;
}

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
    const headers = { ...(opts.headers || {}) };
    // Capture the intended instance before asynchronous CSRF preparation.
    const instanceId = getInstanceId();
    if (!['GET', 'HEAD', 'OPTIONS'].includes((opts.method || 'GET').toUpperCase())) {
        headers['X-CSRF-Token'] = await csrfToken();
    }
    headers['X-Instance-Id'] = instanceId;
    let res;
    try {
        res = await fetch(`${API}${path}`, { ...opts, credentials: 'same-origin', headers });
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
        resetAuthContext();
        if (onUnauth) onUnauth();
    }
    if (!res.ok) {
        if (body?.code === 'CSRF_INVALID') csrfRequest = undefined;
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

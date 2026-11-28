/* eslint-disable i18next/no-literal-string -- Internal API protocol identifiers, error codes, and diagnostics are not localized UI copy */

const API = "/api";

// What the backend selects when a request names no instance.
export const DEFAULT_INSTANCE_ID = "default";

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

export async function authRequest(path, opts = {}) {
    try { return await apiFetch('/auth' + path, opts); }
    finally { csrfRequest = undefined; }
}

export async function fetchAuthStatus() {
    const state = await apiFetch('/auth/status', { cache: 'no-store' });
    if (typeof state?.authenticated !== 'boolean') {
        throw new ApiError('Invalid authentication response', { code: 'INVALID_LOCAL_STATE' });
    }
    return state;
}

// Told whenever the backend no longer accepts this browser's session. Sign-in
// requests are refused the same way, so the app shell listens only while
// signed in.
const unauthorizedListeners = new Set();
export function onUnauthorized(listener) {
    unauthorizedListeners.add(listener);
    return () => unauthorizedListeners.delete(listener);
}

export function getInstanceId() { return localStorage.getItem('caddy_ui_instance') || DEFAULT_INSTANCE_ID; }
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

// A URL for requests the browser makes itself, which can't send the instance
// header: event streams and downloads.
export function instanceUrl(path) {
    return `${API}${path}${path.includes('?') ? '&' : '?'}instance=${encodeURIComponent(getInstanceId())}`;
}

export async function apiFetch(path, opts = {}) {
    return (await apiRequest(path, opts)).body;
}

// apiFetch, also resolving the response headers, e.g. a validator to send back.
// `json` is sent as a JSON body; other options are fetch's.
export async function apiRequest(path, { json, ...opts } = {}) {
    const headers = { ...(opts.headers || {}) };
    if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(json);
    }
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
        if (opts.signal?.aborted) {
            throw cause;
        }
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
    // An aborted body read isn't an empty response
    opts.signal?.throwIfAborted();
    if (res.status === 401) {
        resetAuthContext();
        for (const listener of unauthorizedListeners) listener();
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
    return { body, headers: res.headers };
}

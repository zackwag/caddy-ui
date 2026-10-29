import logger from './logger.js';

export const CADDY_ADMIN_URL = (process.env.CADDY_ADMIN_URL || 'http://caddy:2019').replace(/\/+$/, '');

const HEADERS = {
    'Content-Type': 'application/json',
    'Origin': 'http://0.0.0.0:2019',
};

let timeoutMs = 10000;
// How long a write that already timed out may keep running before caddy-ui
// stops waiting for it. Stopping doesn't prove Caddy didn't apply it.
const LATE_SETTLEMENT_LIMIT_MS = 60000;

// For tests, which can't wait for the real timeout.
export function setRequestTimeout(ms) {
    timeoutMs = ms;
}

// Caddy didn't answer in time. The request may still complete, so callers must
// treat the outcome as unknown: neither applied nor rejected, and not retried.
export class CaddyTimeoutError extends Error {
    constructor(label, ms) {
        super(`Caddy API timeout after ${ms}ms: ${label}`);
        this.name = 'CaddyTimeoutError';
        this.code = 'CADDY_TIMEOUT';
    }
}

// Counts configuration writes per admin API, so observations.js can tell a
// read that may predate a write from one that can't. Bumped once a write
// settles, successful or not, since a failed write can still have changed
// part of the config.
const configGenerations = new Map();

export function configGeneration(adminUrl) {
    return configGenerations.get(adminUrl || CADDY_ADMIN_URL) || 0;
}

export function markConfigChanged(adminUrl) {
    const base = adminUrl || CADDY_ADMIN_URL;
    configGenerations.set(base, configGeneration(base) + 1);
}

// A configuration write as a fetch whose settlement, however late, invalidates
// observations again. A write that timed out can still complete in Caddy, and
// reads made in between would otherwise keep the old config until they expire.
function configWrite(base, label, url, options) {
    const request = fetch(url, { ...options, signal: AbortSignal.timeout(LATE_SETTLEMENT_LIMIT_MS) });
    const tracked = { timedOut: false };
    request.then(
        response => {
            markConfigChanged(base);
            if (tracked.timedOut) logger.warn('Caddy write completed after its timeout', { label, adminUrl: base, status: response.status });
        },
        error => {
            markConfigChanged(base);
            if (tracked.timedOut) logger.warn('Caddy write failed after its timeout', { label, adminUrl: base, error: error.name });
        },
    );
    return withTimeout(request, timeoutMs, label).catch(error => {
        if (error instanceof CaddyTimeoutError) tracked.timedOut = true;
        throw error;
    });
}

export function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new CaddyTimeoutError(label, ms)), ms)
        ),
    ]);
}

async function caddyRequest(method, path, body, adminUrl) {
    const base = adminUrl || CADDY_ADMIN_URL;
    const url = `${base}${path}`;
    const start = Date.now();
    logger.debug(`Caddy API request`, { method, path, adminUrl: base });

    try {
        const options = { method, headers: HEADERS, body: body !== undefined ? JSON.stringify(body) : undefined };
        const label = `${method} ${path}`;
        const res = method === 'GET'
            ? await withTimeout(fetch(url, options), timeoutMs, label)
            : await configWrite(base, label, url, options);

        const elapsed = Date.now() - start;

        if (!res.ok) {
            const text = await res.text();
            logger.error(`Caddy API error`, { method, path, status: res.status, elapsed, body: text.slice(0, 200) });
            throw Object.assign(new Error(`Caddy API error: ${res.status} ${text}`), { status: res.status });
        }

        logger.debug(`Caddy API response`, { method, path, status: res.status, elapsed });
        const text = await res.text();
        if (!text) return null;
        try { return JSON.parse(text); } catch { return text; }
    } catch (err) {
        const elapsed = Date.now() - start;
        if (!err.message.includes('Caddy API error')) {
            logger.error(`Caddy API failed`, { method, path, elapsed, error: err.message });
        }
        throw err;
    } finally {
        if (method !== 'GET') markConfigChanged(base);
    }
}

export const caddyGet = (path, adminUrl) => caddyRequest('GET', path, undefined, adminUrl);
export const caddyPut = (path, body, adminUrl) => caddyRequest('PUT', path, body, adminUrl);
export const caddyPost = (path, body, adminUrl) => caddyRequest('POST', path, body, adminUrl);
export const caddyPatch = (path, body, adminUrl) => caddyRequest('PATCH', path, body, adminUrl);
export const caddyDelete = (path, adminUrl) => caddyRequest('DELETE', path, undefined, adminUrl);

// A read for configuration readback. Unlike caddyGet, its deadline covers the
// body as well as the headers, a body that isn't a JSON object or null is
// rejected rather than returned as text, and an error response's body is
// discarded unread, since it can quote configuration. Rejections carry the
// HTTP status when there was one.
export async function caddyReadJson(path, adminUrl) {
    const base = adminUrl || CADDY_ADMIN_URL;
    const res = await fetch(`${base}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
        await res.body?.cancel();
        throw Object.assign(new Error(`Caddy readback failed: ${res.status}`), { status: res.status });
    }
    const value = await res.json();
    if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
        throw new TypeError('Caddy readback must be a JSON object or null');
    }
    return value;
}

// Adapts Caddyfile text to JSON the same way POST /load does, without
// changing the running config. Rejections carry Caddy's message as `stderr`
// so validation can report it like `caddy adapt` output. The signal keeps the
// deadline in force while the body is read.
export async function caddyAdapt(caddyfileContent, adminUrl) {
    const base = adminUrl || CADDY_ADMIN_URL;
    const res = await withTimeout(
        fetch(`${base}/adapt?adapter=caddyfile`, {
            method: 'POST',
            headers: { ...HEADERS, 'Content-Type': 'text/caddyfile' },
            body: caddyfileContent,
            signal: AbortSignal.timeout(timeoutMs),
        }),
        timeoutMs,
        'POST /adapt'
    );
    const text = await res.text();
    if (!res.ok) {
        throw Object.assign(new Error(text), { status: res.status, stderr: text, stdout: '' });
    }
    return JSON.parse(text).result;
}

export async function caddyLoad(caddyfileContent, adminUrl) {
    const base = adminUrl || CADDY_ADMIN_URL;
    const url = `${base}/load`;
    const start = Date.now();
    logger.info(`Caddy reload initiated`, { adminUrl: base });

    try {
        const res = await configWrite(base, 'POST /load', url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/caddyfile', 'Origin': 'http://0.0.0.0:2019' },
            body: caddyfileContent,
        });

        const elapsed = Date.now() - start;

        if (!res.ok) {
            const text = await res.text();
            logger.error(`Caddy reload failed`, { status: res.status, elapsed, body: text.slice(0, 200) });
            throw new Error(`Caddy reload failed: ${text}`);
        }

        logger.info(`Caddy reload complete`, { elapsed });
    } catch (err) {
        const elapsed = Date.now() - start;
        if (!err.message.includes('Caddy reload failed')) {
            logger.error(`Caddy reload error`, { elapsed, error: err.message });
        }
        throw err;
    } finally {
        markConfigChanged(base);
    }
}

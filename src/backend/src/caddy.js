import logger from './logger.js';

export const CADDY_ADMIN_URL = (process.env.CADDY_ADMIN_URL || 'http://caddy:2019').replace(/\/+$/, '');

const HEADERS = {
    'Content-Type': 'application/json',
    'Origin': 'http://0.0.0.0:2019',
};

const TIMEOUT_MS = 10000;

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

export function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Caddy API timeout after ${ms}ms: ${label}`)), ms)
        ),
    ]);
}

async function caddyRequest(method, path, body, adminUrl) {
    const base = adminUrl || CADDY_ADMIN_URL;
    const url = `${base}${path}`;
    const start = Date.now();
    logger.debug(`Caddy API request`, { method, path, adminUrl: base });

    try {
        const res = await withTimeout(
            fetch(url, {
                method,
                headers: HEADERS,
                body: body !== undefined ? JSON.stringify(body) : undefined,
            }),
            TIMEOUT_MS,
            `${method} ${path}`
        );

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
    const res = await fetch(`${base}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
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
            signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
        TIMEOUT_MS,
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
        const res = await withTimeout(
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/caddyfile', 'Origin': 'http://0.0.0.0:2019' },
                body: caddyfileContent,
            }),
            TIMEOUT_MS,
            'POST /load'
        );

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

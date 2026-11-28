import { createHash } from 'node:crypto';
import logger from './logger.js';

// Caddy's admin API checks the Origin of every request
const ORIGIN = { 'Origin': 'http://0.0.0.0:2019' };
const HEADERS = { 'Content-Type': 'application/json', ...ORIGIN };

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
    return configGenerations.get(adminUrl) || 0;
}

export function markConfigChanged(adminUrl) {
    configGenerations.set(adminUrl, configGeneration(adminUrl) + 1);
}

// Writes per admin API whose requests haven't settled, including ones that
// already timed out. Until they settle, the running config may still change.
const unsettledWrites = new Map();

export function hasUnsettledWrites(adminUrl) {
    return unsettledWrites.has(adminUrl);
}

// A configuration write as a fetch whose settlement, however late, invalidates
// observations again. A write that timed out can still complete in Caddy, and
// reads made in between would otherwise keep the old config until they expire.
function configWrite(adminUrl, label, url, options) {
    const request = fetch(url, { ...options, signal: AbortSignal.timeout(LATE_SETTLEMENT_LIMIT_MS) });
    const tracked = { timedOut: false };
    unsettledWrites.set(adminUrl, (unsettledWrites.get(adminUrl) || 0) + 1);
    const settled = () => {
        const remaining = unsettledWrites.get(adminUrl) - 1;
        if (remaining) {
            unsettledWrites.set(adminUrl, remaining);
        } else {
            unsettledWrites.delete(adminUrl);
        }
    };
    request.finally(settled).catch(() => {});
    request.then(
        response => {
            markConfigChanged(adminUrl);
            if (tracked.timedOut) {
                logger.warn('Caddy write completed after its timeout', { label, adminUrl, status: response.status });
            }
        },
        error => {
            markConfigChanged(adminUrl);
            if (tracked.timedOut) {
                logger.warn('Caddy write failed after its timeout', { label, adminUrl, error: error.name });
            }
        },
    );
    return withTimeout(request, timeoutMs, label).catch(error => {
        if (error instanceof CaddyTimeoutError) {
            tracked.timedOut = true;
        }
        throw error;
    });
}

// Caddy replaces its admin server on every config load and closes the old
// server's idle keep-alive connections. A request sent on one of them just as
// it closes fails with UND_ERR_SOCKET ("other side closed"), or ECONNRESET
// when the connection is reset rather than closed. Right after a
// write, that's the readback, which then looked unavailable although the
// change applied. A request that doesn't change Caddy's state is sent once
// more on a fresh connection. A write is never resent: Caddy may already have
// applied it (see CaddyTimeoutError).
function isClosedConnection(error) {
    return ['UND_ERR_SOCKET', 'ECONNRESET'].includes(error?.cause?.code);
}

async function fetchIdempotent(url, options) {
    try {
        return await fetch(url, options);
    } catch (error) {
        if (!isClosedConnection(error) || options.signal?.aborted) {
            throw error;
        }
        logger.debug('Caddy closed an idle admin connection, sending the read again', { url });
        return fetch(url, options);
    }
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new CaddyTimeoutError(label, ms)), ms)
        ),
    ]);
}

// Resolves to the parsed body and the response's ETag. `ifMatch` makes a write
// conditional: Caddy refuses it with 412 when the config at the ETag's path has
// changed. Caddy releases without ETags send no ETag, and an absent one sends
// no condition.
async function caddyRequest(method, path, body, adminUrl, { ifMatch } = {}) {
    const url = `${adminUrl}${path}`;
    const start = Date.now();
    logger.debug(`Caddy API request`, { method, path, adminUrl });

    try {
        const headers = ifMatch ? { ...HEADERS, 'If-Match': ifMatch } : HEADERS;
        const options = { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined };
        const label = `${method} ${path}`;
        const res = method === 'GET'
            ? await withTimeout(fetchIdempotent(url, options), timeoutMs, label)
            : await configWrite(adminUrl, label, url, options);

        const elapsed = Date.now() - start;

        if (!res.ok) {
            const text = await res.text();
            // A failed precondition is Caddy guarding a concurrent change, not a fault
            const log = res.status === 412 ? logger.warn : logger.error;
            log.call(logger, `Caddy API error`, { method, path, status: res.status, elapsed, body: text.slice(0, 200) });
            throw Object.assign(new Error(`Caddy API error: ${res.status} ${text}`), { status: res.status });
        }

        logger.debug(`Caddy API response`, { method, path, status: res.status, elapsed });
        const etag = res.headers.get('etag');
        const text = await res.text();
        if (!text) {
            return { value: null, etag };
        }
        try { return { value: JSON.parse(text), etag }; } catch { return { value: text, etag }; }
    } catch (err) {
        const elapsed = Date.now() - start;
        if (!err.message.includes('Caddy API error')) {
            logger.error(`Caddy API failed`, { method, path, elapsed, error: err.message });
        }
        throw err;
    }
}

const valueOf = response => response.value;

export const caddyGet = (path, adminUrl) => caddyRequest('GET', path, undefined, adminUrl).then(valueOf);
// A read whose ETag can make a later write conditional on what was read:
// { value, etag }, with etag null when Caddy sends none.
export const caddyGetTagged = (path, adminUrl) => caddyRequest('GET', path, undefined, adminUrl);
export const caddyPut = (path, body, adminUrl, options) => caddyRequest('PUT', path, body, adminUrl, options).then(valueOf);
export const caddyPost = (path, body, adminUrl, options) => caddyRequest('POST', path, body, adminUrl, options).then(valueOf);
export const caddyPatch = (path, body, adminUrl, options) => caddyRequest('PATCH', path, body, adminUrl, options).then(valueOf);
export const caddyDelete = (path, adminUrl, options) => caddyRequest('DELETE', path, undefined, adminUrl, options).then(valueOf);

// A read outside the logged JSON calls above. Resolves to an OK response whose
// headers and body are both covered by the deadline. An error response's body
// is discarded unread, since it can quote configuration, and the rejection
// carries its HTTP status.
async function caddyRead(path, adminUrl, deadlineMs = timeoutMs) {
    const res = await fetchIdempotent(`${adminUrl}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(deadlineMs) });
    if (!res.ok) {
        await res.body?.cancel();
        throw Object.assign(new Error(`Caddy API error: ${res.status}`), { status: res.status });
    }
    return res;
}

// A read for configuration readback. Unlike caddyGet, a body that isn't a JSON
// object or null is rejected rather than returned as text.
export async function caddyReadJson(path, adminUrl) {
    const value = await (await caddyRead(path, adminUrl)).json();
    if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
        throw new TypeError('Caddy readback must be a JSON object or null');
    }
    return value;
}

// A fingerprint of text: of the running config when Caddy sends no ETag, and of
// a Caddyfile, where it's also the editor's ETag, so both name a file the same way.
export const fingerprintText = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;

// The whole running config with a fingerprint of it: Caddy's ETag when it sends
// one (Caddy 2.6+), otherwise a hash of the response body. Equal fingerprints
// mean the same config. The deadline keeps a stalled response from holding the
// instance queue.
export async function caddyGetConfig(adminUrl) {
    const res = await caddyRead('/config/', adminUrl);
    const text = await res.text();
    const etag = res.headers.get('etag');
    return {
        config: text ? JSON.parse(text) : null,
        fingerprint: etag ? `etag:${etag}` : fingerprintText(text),
    };
}

// Optional extras a page or check can do without get a shorter deadline
const OPTIONAL_READ_MS = 3000;

export async function isCaddyOnline(adminUrl) {
    try {
        const res = await caddyRead('/config/', adminUrl, OPTIONAL_READ_MS);
        await res.body?.cancel();
        return true;
    } catch {
        return false;
    }
}

// Prometheus text exposition. Rejects when Caddy's metrics are off.
export async function caddyMetrics(adminUrl) {
    return (await caddyRead('/metrics', adminUrl)).text();
}

// The PEM root certificate of Caddy's local CA. Rejects when there is none.
export async function caddyLocalRootCertificate(adminUrl) {
    const { root_certificate: root } = await (await caddyRead('/pki/ca/local', adminUrl, OPTIONAL_READ_MS)).json();
    if (!root) {
        throw new Error('No root certificate in response');
    }
    return root;
}

// Caddy's reverse proxy pool: [{ address, num_requests, fails }]
export async function caddyUpstreamPool(adminUrl) {
    return (await caddyRead('/reverse_proxy/upstreams', adminUrl, OPTIONAL_READ_MS)).json();
}

// Adapts Caddyfile text to JSON the same way POST /load does, without
// changing the running config. Rejections carry Caddy's message as `stderr`
// so validation can report it like `caddy adapt` output. The signal keeps the
// deadline in force while the body is read.
export async function caddyAdapt(caddyfileContent, adminUrl) {
    const res = await withTimeout(
        // Adapting doesn't change the running config, so it's retried like a read
        fetchIdempotent(`${adminUrl}/adapt?adapter=caddyfile`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/caddyfile', ...ORIGIN },
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
    const url = `${adminUrl}/load`;
    const start = Date.now();
    logger.info(`Caddy reload initiated`, { adminUrl });

    try {
        const res = await configWrite(adminUrl, 'POST /load', url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/caddyfile', ...ORIGIN },
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
    }
}

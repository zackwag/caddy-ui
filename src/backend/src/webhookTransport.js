import http from 'http';
import https from 'https';
import { BlockList, isIP } from 'net';
import { promises as dns } from 'dns';
import { AppError } from './AppError.js';

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const ERROR_SNIPPET_CHARS = 200;

// Private networks (LAN, Docker, Tailscale, IPv6 ULA) are allowed: whoever can set a
// webhook URL can already edit the Caddyfile and proxy to them. Loopback, link-local
// (including common metadata endpoints), unspecified, multicast and reserved addresses are not.
// BlockList also matches IPv4-mapped IPv6 addresses against the IPv4 rules.
const BLOCKED = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]]) {
    BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [['::', 128], ['::1', 128], ['fe80::', 10], ['ff00::', 8]]) {
    BLOCKED.addSubnet(network, prefix, 'ipv6');
}

// Known metadata endpoints in otherwise permitted private ranges. These are
// exact addresses, not a restriction on ordinary LAN, Docker or ULA destinations.
// AWS: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html
// Google: https://docs.cloud.google.com/compute/docs/metadata/querying-metadata#metadata_server_endpoints
// Alibaba: https://www.alibabacloud.com/help/en/ecs/user-guide/view-instance-metadata/
BLOCKED.addAddress('fd00:ec2::254', 'ipv6');
BLOCKED.addAddress('fd20:ce::254', 'ipv6');
BLOCKED.addAddress('100.100.100.200', 'ipv4');

export function isBlockedAddress(address) {
    const version = isIP(address);
    if (!version) return true;
    return BLOCKED.check(address, version === 4 ? 'ipv4' : 'ipv6');
}

function blockedDestination(host) {
    return new AppError('WEBHOOK_DESTINATION_BLOCKED', {
        message: `Webhook destination is a known metadata, loopback, link-local or non-routable address: ${host}`,
        context: { host },
    });
}

export async function resolveWebhookDestination(rawUrl) {
    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error(`Invalid webhook URL: ${rawUrl}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Webhook URL must use http or https: ${rawUrl}`);
    }
    // Credentials and fragments have never been sent; keep it that way.
    url.username = '';
    url.password = '';
    url.hash = '';

    // URL keeps IPv6 literals bracketed, which isIP() does not recognize.
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
    if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal') {
        throw blockedDestination(host);
    }

    const literal = isIP(host);
    const records = literal
        ? [{ address: host, family: literal }]
        : await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length) throw new Error(`Webhook URL host does not resolve: ${host}`);
    // Reject the host if any answer is blocked, so it can't fall back to one.
    if (records.some(record => isBlockedAddress(record.address))) throw blockedDestination(host);

    return { url, address: records[0].address, family: records[0].family, addresses: records };
}

// Stop awaiting slow DNS on timeout. The OS lookup may still finish, but it
// cannot continue delivery; both late resolution and rejection remain handled.
function withSignal(promise, signal) {
    return new Promise((resolve, reject) => {
        const cleanup = () => signal.removeEventListener('abort', onAbort);
        const onAbort = () => {
            cleanup();
            reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(promise).then(
            value => {
                cleanup();
                resolve(value);
            },
            error => {
                cleanup();
                reject(error);
            },
        );
        if (signal.aborted) onAbort();
    });
}

/**
 * Send one webhook request. The host is resolved and checked once, and the connection
 * uses only the checked answers, so a DNS change between the two cannot redirect it.
 * Address fallback happens while establishing a socket, never by retrying a POST.
 */
export async function sendWebhook(rawUrl, { name, method = 'POST', headers = {}, body = '' }, {
    resolveDestination = resolveWebhookDestination,
    timeoutMs = TIMEOUT_MS,
} = {}) {
    // One wall-clock budget covers DNS, connection fallback, TLS and response data.
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(() => controller.abort(new Error(`${name} request timed out`)), timeoutMs);
    try {
        const destination = await withSignal(resolveDestination(rawUrl), signal);
        signal.throwIfAborted();
        const addresses = destination.addresses ?? [{ address: destination.address, family: destination.family }];
        const client = destination.url.protocol === 'https:' ? https : http;
        const payload = Buffer.from(body);

        await withSignal(new Promise((resolve, reject) => {
            const request = client.request(destination.url, {
                method,
                headers: { ...headers, 'Content-Length': payload.length },
                // A fresh socket and a lookup pinned to the checked answers. The URL still
                // supplies the Host header, TLS server name and certificate verification.
                agent: false,
                signal,
                family: 0,
                autoSelectFamily: true,
                lookup: (_host, options, callback) => {
                    if (options.all) callback(null, addresses);
                    else callback(null, addresses[0].address, addresses[0].family);
                },
            }, response => {
                const chunks = [];
                let size = 0;
                response.on('error', reject);
                response.on('data', chunk => {
                    size += chunk.length;
                    if (size > MAX_RESPONSE_BYTES) request.destroy(new Error(`${name} response exceeds size limit`));
                    else chunks.push(chunk);
                });
                response.on('end', () => {
                    const status = response.statusCode;
                    if (status >= 200 && status < 300) resolve();
                    else if (status >= 300 && status < 400) reject(new Error(`${name} responded ${status}; redirects are not followed, so configure the final URL`));
                    else reject(new Error(`${name} responded ${status}: ${Buffer.concat(chunks).toString('utf8').slice(0, ERROR_SNIPPET_CHARS)}`));
                });
            });
            request.on('error', reject);
            request.end(payload);
        }), signal);
    } catch (error) {
        if (signal.aborted) throw signal.reason;
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

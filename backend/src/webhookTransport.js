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
// (including cloud metadata), unspecified, multicast and reserved addresses are not.
// BlockList also matches IPv4-mapped IPv6 addresses against the IPv4 rules.
const BLOCKED = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]]) {
    BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [['::', 128], ['::1', 128], ['fe80::', 10], ['ff00::', 8]]) {
    BLOCKED.addSubnet(network, prefix, 'ipv6');
}

export function isBlockedAddress(address) {
    const version = isIP(address);
    if (!version) return true;
    return BLOCKED.check(address, version === 4 ? 'ipv4' : 'ipv6');
}

function blockedDestination(host) {
    return new AppError('WEBHOOK_DESTINATION_BLOCKED', {
        message: `Webhook destination is a loopback, link-local or non-routable address: ${host}`,
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

    return { url, address: records[0].address, family: records[0].family };
}

/**
 * Send one webhook request. The host is resolved and checked once, and the connection
 * goes only to the checked address, so a DNS change between the two can't redirect it.
 */
export async function sendWebhook(rawUrl, { name, method = 'POST', headers = {}, body = '' }, {
    resolveDestination = resolveWebhookDestination,
    timeoutMs = TIMEOUT_MS,
} = {}) {
    const destination = await resolveDestination(rawUrl);
    const client = destination.url.protocol === 'https:' ? https : http;
    const payload = Buffer.from(body);

    await new Promise((resolve, reject) => {
        const request = client.request(destination.url, {
            method,
            headers: { ...headers, 'Content-Length': payload.length },
            // A fresh socket and a lookup pinned to the checked address. The URL still
            // supplies the Host header, TLS server name and certificate verification.
            agent: false,
            family: destination.family,
            autoSelectFamily: false,
            lookup: (_host, options, callback) => {
                if (options.all) callback(null, [{ address: destination.address, family: destination.family }]);
                else callback(null, destination.address, destination.family);
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
        // A wall-clock deadline also bounds a peer that keeps sending tiny chunks.
        const timer = setTimeout(() => request.destroy(new Error(`${name} request timed out`)), timeoutMs);
        request.on('close', () => clearTimeout(timer));
        request.on('error', reject);
        request.end(payload);
    });
}

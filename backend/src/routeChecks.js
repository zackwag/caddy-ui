import http from 'http';
import https from 'https';
import { isIP } from 'net';
import tls from 'tls';
import { caddyGet } from './caddy.js';
import { getHost } from './upstreamChecks.js';

const PROBE_TIMEOUT_MS = 5000;
const USER_AGENT = 'caddy-ui-route-check';

// First TCP port a server listens on. Listen addresses look like ":443",
// "0.0.0.0:8443" or "tcp/:443"; "udp/..." entries are HTTP/3 and skipped.
export function getListenPort(server) {
    for (const addr of server.listen || []) {
        if (/^udp\d?\//.test(addr)) continue;
        const port = Number(addr.split(':').pop().split('-')[0]);
        if (port) return port;
    }
    return null;
}

// Caddy serves HTTPS on every listener except the HTTP port, unless automatic
// HTTPS is disabled for the server and it has no explicit TLS policies.
export function getServerScheme(server, port) {
    if (port === 80) return 'http';
    if (server.automatic_https?.disable && !server.tls_connection_policies) return 'http';
    return 'https';
}

// One probe target per distinct site address. Routes without a concrete host
// (catch-alls, path-only matchers, wildcards, placeholders) can't be requested
// by name, so they're skipped.
export function collectRouteTargets(servers) {
    const targets = new Map();
    for (const [serverName, server] of Object.entries(servers || {})) {
        const port = getListenPort(server);
        if (!port) continue;
        const scheme = getServerScheme(server, port);
        for (const route of server.routes || []) {
            const host = getHost(route);
            if (!host || host.includes('*') || host.includes('{') || targets.has(host)) continue;
            targets.set(host, { host, scheme, port, server: serverName });
        }
    }
    return [...targets.values()];
}

// Redirects and auth challenges (3xx/401/403) still mean Caddy routed the
// request and something answered; only server errors count as down.
export function isRouteUp(statusCode) {
    return statusCode > 0 && statusCode < 500;
}

// CAs a route's certificate may chain to: Node's defaults (bundled roots plus
// NODE_EXTRA_CA_CERTS) and, when the instance has one, Caddy's local CA, which
// signs the certificates for internal names like *.internal.
export async function getTrustedCAs(adminUrl) {
    const defaults = tls.getCACertificates?.('default') ?? tls.rootCertificates;
    try {
        const res = await fetch(`${adminUrl}/pki/ca/local`, {
            headers: { 'Origin': 'http://0.0.0.0:2019' },
            signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
            const { root_certificate: root } = await res.json();
            if (root) return [...defaults, root];
        }
    } catch { }
    return [...defaults];
}

// Requests the site from the instance's Caddy listener directly, naming the
// route via SNI and Host so internal hostnames don't depend on the backend's
// DNS. The certificate is verified as a browser would (trusted chain, not
// expired, matches the route's host), so a bad certificate fails the check.
function probeRoute(connectHost, ca, { host, scheme, port }) {
    return new Promise((resolve) => {
        const client = scheme === 'https' ? https : http;
        const req = client.request({
            host: connectHost,
            port,
            path: '/',
            method: 'GET',
            agent: false,
            headers: { Host: host, 'User-Agent': USER_AGENT },
            // We connect to the instance's address, so check the certificate
            // against the route's host instead
            ...(scheme === 'https' && { ca, servername: isIP(host) ? undefined : host, checkServerIdentity: (_, cert) => tls.checkServerIdentity(host, cert) }),
            timeout: PROBE_TIMEOUT_MS,
        }, (res) => {
            res.destroy();
            resolve({ statusCode: res.statusCode, online: isRouteUp(res.statusCode), error: null });
        });
        req.on('timeout', () => req.destroy(new Error('timed out')));
        req.on('error', (err) => resolve({ statusCode: null, online: false, error: err.message }));
        req.end();
    });
}

// Probes every named route in an instance's live config. Throws when the
// admin API is unreachable, like checkInstanceUpstreams.
export async function checkInstanceRoutes(adminUrl) {
    const servers = await caddyGet('/config/apps/http/servers', adminUrl);
    const connectHost = new URL(adminUrl).hostname.replace(/^\[|\]$/g, '');
    const targets = collectRouteTargets(servers);
    const ca = targets.some(t => t.scheme === 'https') ? await getTrustedCAs(adminUrl) : undefined;
    return Promise.all(targets.map(async (target) => ({ ...target, ...await probeRoute(connectHost, ca, target) })));
}

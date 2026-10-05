import http from 'http';
import https from 'https';
import { isIP } from 'net';
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

export function isCertCurrent(cert, now = Date.now()) {
    if (!cert?.valid_from || !cert?.valid_to) return true;
    return Date.parse(cert.valid_from) <= now && now <= Date.parse(cert.valid_to);
}

// Requests the site from the instance's Caddy listener directly, naming the
// route via SNI and Host so internal hostnames don't depend on the backend's
// DNS. The chain isn't verified (internal CAs are common), but an expired
// certificate fails the check since browsers would refuse it too.
function probeRoute(connectHost, { host, scheme, port }) {
    return new Promise((resolve) => {
        const client = scheme === 'https' ? https : http;
        const req = client.request({
            host: connectHost,
            port,
            path: '/',
            method: 'GET',
            agent: false,
            headers: { Host: host, 'User-Agent': USER_AGENT },
            ...(scheme === 'https' && { servername: isIP(host) ? undefined : host, rejectUnauthorized: false }),
            timeout: PROBE_TIMEOUT_MS,
        }, (res) => {
            const certOk = scheme !== 'https' || isCertCurrent(res.socket.getPeerCertificate?.());
            res.destroy();
            resolve({ statusCode: res.statusCode, online: certOk && isRouteUp(res.statusCode), error: certOk ? null : 'certificate expired' });
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
    return Promise.all(targets.map(async (target) => ({ ...target, ...await probeRoute(connectHost, target) })));
}

// Helpers for reading routes from the live admin API config
// (/config/apps/http/servers/*/routes), shared by the Routes and Metrics views.

export function getRouteHosts(route) {
    return route.match?.find(m => m.host)?.host || [];
}

// What a route's notes and maintenance are stored under: its hosts, or '' when
// it has none.
export function getRouteHost(route) {
    return getRouteHosts(route).join(", ");
}

// Display only: never feed this fallback into the saved title or Caddyfile.
export function getRouteTitle(route, title) {
    if (title) return title;
    const [host] = getRouteHosts(route);
    if (!host) return '';
    const hostname = host.replace(/\.$/, '');
    const labels = hostname.split('.');
    if (hostname.length > 253 || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
        || !labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return '';
    return labels[0];
}

// The host route checks request the route by (backend routeChecks.js
// collectRouteTargets): its first host, unless that's a wildcard or placeholder.
function getRouteCheckHost(route) {
    // Route checks skip a server without a TCP listen port (unix sockets, HTTP/3 only)
    if (route._listenPort === null) {
        return null;
    }
    const [host] = getRouteHosts(route);
    return host && !host.includes("*") && !host.includes("{") ? host : null;
}

// Every reverse_proxy dial in the route, including ones nested in subroutes.
export function getRouteUpstreams(route) {
    const dials = [];
    function walk(handles) {
        for (const h of handles || []) {
            if (h.handler === 'reverse_proxy' && h.upstreams) {
                for (const u of h.upstreams) if (u.dial) dials.push(u.dial);
            }
            if (h.routes) {
                for (const r of h.routes) walk(r.handle);
            }
        }
    }
    walk(route.handle);
    return dials;
}

// What each route status is called, wherever it's shown. A route in maintenance
// isn't checked.
export const STATUS_LABEL_KEYS = {
    online: 'routes.online',
    partial: 'routes.partial',
    offline: 'routes.offline',
    maintenance: 'routes.maintenance',
    unknown: 'uptime.noData',
    none: 'uptime.noData',
};

// none: nothing to check; unknown: not checked yet. Each upstream's state is
// the monitor's latest record of it.
function upstreamsStatus(upstreams, uptime) {
    if (!upstreams.length) return 'none';
    const known = upstreams.map(upstream => uptime[upstream]?.currentlyOnline).filter(online => online !== undefined);
    if (!known.length) return 'unknown';
    const online = known.filter(Boolean).length;
    return online === upstreams.length ? 'online' : online > 0 ? 'partial' : 'offline';
}

// A route's status, the same wherever it's shown. With route checks on, a route
// that can be requested by name uses its own check, including one with no
// upstream; the rest (wildcards, catch-alls) and excluded routes follow their
// upstreams. Uptime and history follow a route's first upstream, while status
// considers all of them.
export function getRouteStatus(route, { uptime, routeUptime, routeChecks, excludes }) {
    const upstreams = getRouteUpstreams(route);
    const probeHost = routeChecks ? getRouteCheckHost(route) : null;
    const excluded = !!probeHost && excludes.has(probeHost.toLowerCase());
    const checkHost = excluded ? null : probeHost;
    const stats = (checkHost ? routeUptime[checkHost] : uptime[upstreams[0]]) || null;
    const upstreamState = upstreamsStatus(upstreams, uptime);
    const status = !checkHost ? upstreamState : !stats ? 'unknown' : stats.currentlyOnline ? 'online' : 'offline';
    return {
        upstreams, probeHost, excluded, checkHost, stats, upstreamState, status,
        // Route checks run every 5 minutes, so don't wait for a second one
        pct: stats && stats.total > (checkHost ? 0 : 1) ? stats.pct : null,
        failure: checkHost && status === 'offline' ? stats.lastFailure || null : null,
        history: checkHost ? { route: checkHost } : upstreams.length ? { upstream: upstreams[0] } : null,
    };
}

// Worst uptime first, for getRouteStatus results; one with no uptime yet sorts last.
export const compareUptime = (a, b) => (a.pct ?? 101) - (b.pct ?? 101);

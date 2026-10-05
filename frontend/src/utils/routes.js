// Helpers for reading routes from the live admin API config
// (/config/apps/http/servers/*/routes), shared by the Routes and Metrics views.

export function getRouteHost(route) {
    return route.match?.find(m => m.host)?.host?.join(", ") || "—";
}

// The host route checks request the route by (backend routeChecks.js
// collectRouteTargets): its first host, unless that's a wildcard or placeholder.
export function getRouteCheckHost(route) {
    const host = route.match?.find(m => m.host)?.host?.[0];
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

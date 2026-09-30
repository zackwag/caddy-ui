// Helpers for reading routes from the live admin API config
// (/config/apps/http/servers/*/routes), shared by the Routes and Metrics views.

export function getRouteHost(route) {
    return route.match?.find(m => m.host)?.host?.join(", ") || "—";
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

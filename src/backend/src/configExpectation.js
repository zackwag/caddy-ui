// Describe only the route mutation submitted to Caddy. Apply it to the last
// expected config, never to a fresh observation which may include external edits.
export function routeExpectation({ operation, id, route, serverName }) {
    return previous => {
        if (!previous || typeof previous !== 'object') return undefined;
        const config = structuredClone(previous);
        if (operation === 'add') {
            const servers = config.apps?.http?.servers;
            if (!servers || !Object.hasOwn(servers, serverName)) return undefined;
            const server = servers[serverName];
            if (!server || (server.routes != null && !Array.isArray(server.routes))) return undefined;
            server.routes ??= [];
            server.routes.push(structuredClone(route));
            return config;
        }
        const matches = [];
        const visit = parent => {
            if (!parent || typeof parent !== 'object') return;
            for (const [key, child] of Object.entries(parent)) {
                if (child && typeof child === 'object' && child['@id'] === id) matches.push({ parent, key });
                visit(child);
            }
        };
        visit(config);
        // Missing/ambiguous IDs can't justify changing the baseline. In
        // particular, editing an externally added route doesn't approve it.
        if (matches.length !== 1) return undefined;
        const { parent, key } = matches[0];
        if (operation === 'replace') parent[key] = structuredClone(route);
        else if (operation === 'remove') {
            if (Array.isArray(parent)) parent.splice(Number(key), 1);
            else delete parent[key];
        } else return undefined;
        return config;
    };
}

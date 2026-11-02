import { validateName } from './harness.mjs';

// Real Caddy configuration shared by interactive development and documentation
// capture. Each site proxies to its own port on the owned upstream Caddy;
// `service` is the name documentation shows in place of that Caddy's private IP.
export const EXAMPLE_SITES = [
    { domain: 'example.com', title: 'Home Assistant', port: 8123, service: 'homeassistant' },
    { domain: 'media.home.arpa', title: 'Jellyfin', port: 8096, service: 'jellyfin' },
    { domain: 'api.internal', title: 'Internal API', port: 8080, service: 'api' },
];

export const EXAMPLE_UPSTREAM = 'example-upstream';

// Development adds the plain-HTTP /health and /error responses that readiness
// checks rely on, and keeps Caddy's own logs on stderr for `docker logs`.
// Documentation leaves both out so every route has a domain and the Logs
// view shows only site traffic.
export function exampleCaddyfile(address, { development = false } = {}) {
    return `{
    admin 0.0.0.0:2019
    auto_https disable_redirects
    metrics
    log {
        output file /data/dev-caddy/logs/access.log
        format json
        include http.log.access
    }${development ? `
    log diagnostics {
        output stderr
        exclude http.log.access
    }` : ''}
}
${development ? `
:80 {
    log
    respond /health "ok" 200
    respond /error "deliberate test error" 503
    respond "Caddy UI example instance" 200
}
` : ''}
${EXAMPLE_SITES.map(({ domain, title, port }) => `${domain} {
    # ${title}
    tls internal
    log
    reverse_proxy ${address}:${port}
}`).join('\n\n')}
`;
}

export function exampleUpstreamCaddyfile() {
    return `{
    admin 0.0.0.0:2019
    auto_https off
}

${EXAMPLE_SITES.map(site => ':' + site.port).join(', ')} {
    respond /error "deliberate test error" 503
    respond "OK" 200
}
`;
}

// Caddy reaches its peer on the Docker network, not the host's published
// loopback port, which points back to Caddy itself inside its container.
export async function containerAddress(harness, containerName) {
    const networks = (await harness.inspect('container', containerName))?.NetworkSettings.Networks || {};
    // Docker names its default network "bridge"; other engines may not.
    const address = (networks[await harness.network() || 'bridge'] ?? Object.values(networks)[0])?.IPAddress;
    if (!address) throw new Error(`${containerName} has no address on the Caddy network`);
    return address;
}

// Example upstream addresses in a Caddyfile that no longer match the upstream.
export function staleExampleAddresses(caddyfile, address) {
    const ports = EXAMPLE_SITES.map(site => site.port).join('|');
    const found = [...caddyfile.matchAll(new RegExp(`reverse_proxy\\s+(\\d+\\.\\d+\\.\\d+\\.\\d+):(?:${ports})\\b`, 'g'))].map(match => match[1]);
    return [...new Set(found)].filter(previous => previous !== address);
}

// The harness writes the Caddyfile only when the volume has none, so restarting
// or recreating a container never replaces a developer's edits. Docker can give
// the upstream a new IP when it starts, which those edits can't follow, so a
// retained Caddyfile pointing at an old address gets a warning instead.
export async function createExampleInstance(harness, name) {
    validateName(name);
    if (name === EXAMPLE_UPSTREAM) throw new Error(`${EXAMPLE_UPSTREAM} is reserved for the example service`);
    const upstream = await harness.create(EXAMPLE_UPSTREAM, { caddyfile: exampleUpstreamCaddyfile() });
    const address = await containerAddress(harness, upstream.instance.containerName);
    const info = await harness.create(name, { caddyfile: exampleCaddyfile(address, { development: true }), publishHttps: true });
    // A new volume may not have written its Caddyfile yet, but it would use the current address anyway.
    const caddyfile = await harness.run(['exec', info.instance.containerName, 'sh', '-c', 'cat "$1" 2>/dev/null || true', 'sh', info.instance.configPath]);
    for (const previous of staleExampleAddresses(caddyfile, address)) {
        console.warn(`${name}: the Caddyfile proxies to ${previous}, but ${EXAMPLE_UPSTREAM} is now at ${address}. Update those reverse_proxy addresses to reach the example sites.`);
    }
    return info;
}

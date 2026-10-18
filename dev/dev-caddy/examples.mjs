import { validateName } from './harness.mjs';

// Real Caddy configuration shared by interactive development and documentation capture.
export const EXAMPLE_SITES = [
    { domain: 'example.com', title: 'Home Assistant' },
    { domain: 'media.home.arpa', title: 'Jellyfin' },
    { domain: 'api.internal', title: 'Internal API' },
];

export function exampleCaddyfile(upstream) {
    return `{
    admin 0.0.0.0:2019
    auto_https disable_redirects
    skip_install_trust
    metrics
    log {
        output file /data/dev-caddy/logs/access.log
        format json
    }
}

(example_backend) {
    reverse_proxy ${upstream} {
        transport http {
            network_proxy none
        }
    }
}

:80 {
    log
    @sites host ${EXAMPLE_SITES.map(site => site.domain).join(' ')}
    handle @sites {
        import example_backend
    }
    handle {
        respond /health "ok" 200
        respond /error "deliberate test error" 503
        respond "Caddy UI example instance" 200
    }
}

${EXAMPLE_SITES.map(({ domain, title }) => `${domain} {
    # ${title}
    tls internal
    log
    import example_backend
}`).join('\n\n')}
`;
}

// Resolve the peer address on the same Docker network as Caddy. A host-published
// loopback port points back to Caddy itself when used inside its container.
export async function exampleUpstream(harness, instance) {
    const container = await harness.inspect('container', instance.containerName);
    const network = await harness.network() || 'bridge';
    const address = container.NetworkSettings.Networks[network]?.IPAddress;
    if (!address) throw new Error('Example upstream has no address on the Caddy network');
    return address + ':80';
}

// The harness writes this only when the instance's Caddyfile is absent, so
// restarting or recreating a container never replaces a developer's edits.
export async function createExampleInstance(harness, name) {
    validateName(name);
    if (name === 'example-upstream') throw new Error('example-upstream is reserved for the example service');
    const upstream = await harness.create('example-upstream');
    return harness.create(name, {
        caddyfile: exampleCaddyfile(await exampleUpstream(harness, upstream.instance)),
        publishHttps: true,
    });
}

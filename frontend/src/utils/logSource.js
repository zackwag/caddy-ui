// Query values are public links; "app" is the existing internal source ID.
export function resolveLogSource(search, noInstances = false) {
    if (noInstances) return 'app';
    return new URLSearchParams(search).get('dist') === 'caddyui' ? 'app' : 'caddy';
}

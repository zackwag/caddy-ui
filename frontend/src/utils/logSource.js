// Link destinations use the same IDs as the log source selector.
export function resolveLogSource(search, noInstances = false) {
    if (noInstances) return 'app';
    return new URLSearchParams(search).get('dist') === 'app' ? 'app' : 'caddy';
}

const TOKEN_URL = 'https://auth.docker.io/token';
const REGISTRY_URL = 'https://registry-1.docker.io';

const IMAGE_REPOS = {
    frontend: 'zackwag/caddy-ui-frontend',
    backend: 'zackwag/caddy-ui-backend',
};

const CACHE_TTL_MS = 15 * 60 * 1000;

let cache = null;
let cacheTime = 0;

function parseVersion(version) {
    const match = String(version).match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return null;
    return match.slice(1).map(Number);
}

export function compareVersions(a, b) {
    const av = parseVersion(a);
    const bv = parseVersion(b);

    if (!av || !bv) return 0;

    for (let i = 0; i < 3; i++) {
        if (av[i] !== bv[i]) return av[i] - bv[i];
    }

    return 0;
}

function latestStableVersion(tags) {
    return (tags || [])
        .filter(tag => /^\d+\.\d+\.\d+$/.test(tag))
        .sort((a, b) => compareVersions(b, a))[0] || null;
}

async function getRegistryToken(repository) {
    const url = new URL(TOKEN_URL);
    url.searchParams.set('service', 'registry.docker.io');
    url.searchParams.set('scope', `repository:${repository}:pull`);

    const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
        throw new Error(`Docker token request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.token;
}

async function getLatestVersion(repository) {
    const token = await getRegistryToken(repository);

    const response = await fetch(
        `${REGISTRY_URL}/v2/${repository}/tags/list?n=100`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
            },
            signal: AbortSignal.timeout(5000),
        }
    );

    if (!response.ok) {
        throw new Error(`Docker tags request failed: ${response.status}`);
    }

    const data = await response.json();
    return latestStableVersion(data.tags);
}

export async function getLatestImageVersions() {
    if (cache && Date.now() - cacheTime < CACHE_TTL_MS) {
        return cache;
    }

    const [frontend, backend] = await Promise.allSettled([
        getLatestVersion(IMAGE_REPOS.frontend),
        getLatestVersion(IMAGE_REPOS.backend),
    ]);

    cache = {
        frontend: frontend.status === 'fulfilled' ? frontend.value : null,
        backend: backend.status === 'fulfilled' ? backend.value : null,
    };

    cacheTime = Date.now();
    return cache;
}

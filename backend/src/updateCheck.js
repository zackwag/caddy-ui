import logger from './logger.js';

// Release, beta, and edge builds record what they pushed in versions.json on
// the repo's orphan `versions` branch (see .github/scripts/record-versions.mjs).
// Shape: { schema: 1, channels: { stable|beta|edge: { frontend|backend: [newest, ...older] } } }
// Fetching that one small file avoids paging through Docker Hub tags, and
// knows about edge/beta builds, which have no comparable version number.
const DEFAULT_URL = 'https://raw.githubusercontent.com/zackwag/caddy-ui/versions/versions.json';
export const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

const ENABLED = process.env.CADDY_UI_UPDATE_CHECK !== 'false';
const MANIFEST_URL = process.env.CADDY_UI_UPDATE_CHECK_URL || DEFAULT_URL;

let manifest = null;
let timer = null;

function parseVersion(version) {
    const match = String(version).match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    return match ? match.slice(1).map(Number) : null;
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

// APP_VERSION is X.Y.Z for releases, beta-<sha> / edge-<sha> otherwise, and
// dev for local builds, which never get an update notice.
export function channelOf(version) {
    if (parseVersion(version)) return 'stable';
    const match = String(version).match(/^(beta|edge)-[0-9a-f]+$/);
    return match ? match[1] : null;
}

// Returns the newer version to offer, or null when up to date or unknown.
// Beta/edge builds can't be ordered, so they're only reported as behind when
// the running build appears in the channel's history -- a build that isn't
// listed yet (e.g. pulled moments before versions.json updated) stays quiet.
export function availableUpdate(data, component, version) {
    const channel = channelOf(version);
    const history = data?.channels?.[channel]?.[component];
    if (!channel || !Array.isArray(history) || !history.length) return null;
    const [latest] = history;
    if (channel === 'stable') return compareVersions(latest, version) > 0 ? latest : null;
    return latest !== version && history.includes(version) ? latest : null;
}

export function isValidManifest(data) {
    return !!data && typeof data === 'object' && data.schema === 1
        && !!data.channels && typeof data.channels === 'object';
}

// Update info for GET /api/version: null when the check is disabled or no
// manifest has loaded, so the sidebar simply shows nothing.
export function getUpdateInfo({ backend, frontend }) {
    if (!manifest) return null;
    return {
        backend: availableUpdate(manifest, 'backend', backend),
        frontend: availableUpdate(manifest, 'frontend', frontend),
    };
}

async function refresh() {
    try {
        const res = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!isValidManifest(data)) throw new Error('unrecognized versions.json format');
        manifest = data;
    } catch (err) {
        // Keep the last good manifest; offline installs just never see a badge
        logger.debug('Update check failed', { url: MANIFEST_URL, error: err.message });
    }
}

export function startUpdateCheck() {
    if (!ENABLED || timer) return;
    refresh();
    timer = setInterval(refresh, REFRESH_INTERVAL_MS).unref();
}

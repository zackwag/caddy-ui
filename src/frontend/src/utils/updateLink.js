const REPO_URL = "https://github.com/zackwag/caddy-ui";
// eslint-disable-next-line i18next/no-literal-string -- GET /api/version field names, not UI copy
const COMPONENTS = ["backend", "frontend"];

// Edge and beta builds are named after the commit they were built from
// ("edge-c6a3f0f"); releases and dev builds have no commit to compare.
const commitOf = (version) => String(version || "").match(/^(?:edge|beta)-([0-9a-f]+)$/)?.[1] || null;

// Where the sidebar's update badge points. A stable update links to the
// release notes. Edge/beta builds have none, so they link to the commits
// between the running build and the offered one -- the backend's when both
// images have an update -- or to main's history when either commit is unknown.
export function updateLink(update, running) {
    const offered = COMPONENTS.filter(component => update?.[component]);
    if (!offered.length) return null;
    if (offered.some(component => /^\d/.test(update[component]))) return `${REPO_URL}/releases`;
    const [component] = offered;
    const from = commitOf(running?.[component]);
    const to = commitOf(update[component]);
    return from && to ? `${REPO_URL}/compare/${from}...${to}` : `${REPO_URL}/commits/main`;
}

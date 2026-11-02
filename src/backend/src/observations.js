import { caddyGet, configGeneration } from './caddy.js';
import { checkInstanceUpstreams } from './upstreamChecks.js';

// Short-lived observations of each Caddy instance, keyed by its admin API URL:
// the HTTP server config, and the upstream checks made against it. Route
// handlers and monitors that need the same observation at about the same time
// share one admin API read and one dial per upstream instead of each making
// their own. Results are shared, so callers must not modify them.
//
// A result is reused until OBSERVATION_MAX_AGE_MS after it settles, and never
// after a configuration write through caddy-ui (see configGeneration), so
// edits show up right away. Changes made outside caddy-ui show up within
// OBSERVATION_MAX_AGE_MS. Failures aren't reused: the next caller retries.
export const OBSERVATION_MAX_AGE_MS = 5_000;

const entries = new Map();

function isCurrent(entry, adminUrl, now) {
    return entry.generation === configGeneration(adminUrl)
        && (entry.settledAt === null || now - entry.settledAt <= OBSERVATION_MAX_AGE_MS);
}

function observe(kind, adminUrl, collect, sourceConfig) {
    const key = `${kind} ${adminUrl}`;
    const now = Date.now();
    const existing = entries.get(key);
    if (existing && existing.sourceConfig === sourceConfig && isCurrent(existing, adminUrl, now)) return existing.promise;

    // Expired entries are dropped as new ones are made, so removed instances
    // don't accumulate.
    for (const [other, entry] of entries) {
        if (entry.settledAt !== null && now - entry.settledAt > OBSERVATION_MAX_AGE_MS) entries.delete(other);
    }
    // Taken before collecting, so a write that lands mid-read retires the result.
    const entry = { generation: configGeneration(adminUrl), settledAt: null, sourceConfig };
    entry.promise = collect().then(value => {
        entry.settledAt = Date.now();
        return value;
    }, err => {
        if (entries.get(key) === entry) entries.delete(key);
        throw err;
    });
    entries.set(key, entry);
    return entry.promise;
}

// The instance's /config/apps/http/servers. Rejects when the admin API can't
// be read, which callers report as Caddy being unavailable.
export function getServers(adminUrl) {
    return observe('servers', adminUrl, () => caddyGet('/config/apps/http/servers', adminUrl));
}

// Upstream checks for the instance's current config, with when they were
// made. Rejects when the config can't be read, so an unreachable Caddy never
// reads as "no upstreams". Resolve the config first so cached checks cannot
// outlive the server observation they were collected from.
export async function getUpstreamChecks(adminUrl) {
    const servers = await getServers(adminUrl);
    return observe('upstreams', adminUrl, async () => {
        const checks = await checkInstanceUpstreams(adminUrl, servers);
        return { checks, checkedAt: new Date() };
    }, servers);
}

// For tests, which change what Caddy returns between cases.
export function clearObservations() {
    entries.clear();
}

import { getInstances } from './instances.js';
import logger from './logger.js';
import { getUpstreamChecks } from './observations.js';
import { checkInstanceRoutes, failureReason } from './routeChecks.js';
import { getSettings } from './settings.js';
import { forgetInstanceHistory, getStatsForInstance, recordCheck } from './uptimeHistory.js';
import { resultsByUpstream } from './upstreamChecks.js';

// The only recorder of uptime history: one sample per target every interval,
// whether or not anyone has the UI open, so how often browsers poll can't
// skew the percentages. Each result is { target, online, label, failure? }.
// Targets whose last sample is older than staleMs are no longer being checked.
export const PROBES = {
    upstream: {
        intervalMs: 30_000,
        staleMs: 5 * 60_000,
        enabled: () => true,
        check: async inst => resultsByUpstream((await getUpstreamChecks(inst.adminUrl)).checks),
    },
    // Route checks send real requests through Caddy, so they show up in its
    // access logs and request metrics. They run far less often to keep that
    // noise small.
    route: {
        intervalMs: 5 * 60_000,
        staleMs: 12.5 * 60_000,
        enabled: () => getSettings().routeChecks,
        check: async inst => (await checkInstanceRoutes(inst.adminUrl, { exclude: getSettings().routeCheckExcludes }))
            .map(check => ({ target: check.host, online: check.online, label: check.host, failure: failureReason(check) })),
    },
};

const timers = new Map();
const running = new Map();
const listeners = new Set();
// kind -> instance id -> target -> why its latest check failed. Kept in memory
// only: a restart re-runs the checks right away.
const failures = new Map(Object.keys(PROBES).map(kind => [kind, new Map()]));

export function onCheckResults(listener) {
    listeners.add(listener);
}

// Uptime stats for an instance's targets of one kind, each with why its
// latest check failed, when it did.
export function instanceUptime(instanceId, kind) {
    const stats = getStatsForInstance(instanceId, kind);
    const failed = failures.get(kind).get(instanceId) || {};
    for (const [target, s] of Object.entries(stats)) {
        if (s && failed[target]) {
            s.lastFailure = failed[target];
        }
    }
    return stats;
}

// Every kind's uptime stats for each instance, as formatUptimeMetrics takes
// them, and how old each kind's last check may be before it's stale.
export function uptimeSnapshot(instances) {
    return {
        staleMs: Object.fromEntries(Object.entries(PROBES).map(([kind, probe]) => [kind, probe.staleMs])),
        instances: instances.map(({ id, name }) => ({
            id, name, stats: Object.fromEntries(Object.keys(PROBES).map(kind => [kind, getStatsForInstance(id, kind)])),
        })),
    };
}

async function checkInstance(kind, inst) {
    let results;
    try {
        results = await PROBES[kind].check(inst);
    } catch (err) {
        logger.warn('Monitor could not reach instance', { kind, instance: inst.name, error: err.message });
        return;
    }
    const failed = {};
    for (const result of results) {
        recordCheck(inst.id, result.target, result.online, kind);
        if (result.failure) {
            failed[result.target] = result.failure;
        }
    }
    failures.get(kind).set(inst.id, failed);
    for (const listener of listeners) {
        await Promise.resolve()
            .then(() => listener(kind, inst, results))
            .catch(err => logger.warn('Check result listener failed', { kind, instance: inst.name, error: err.message }));
    }
}

// Runs a round of checks unless one is already in flight. Also called when
// route checks are switched on so results show up without waiting a round.
export function runChecks(kind) {
    if (!PROBES[kind].enabled() || running.has(kind)) {
        return running.get(kind);
    }
    const round = Promise.all(getInstances().map(inst => checkInstance(kind, inst)))
        .finally(() => running.delete(kind));
    running.set(kind, round);
    return round;
}

export function startMonitoring() {
    for (const [kind, probe] of Object.entries(PROBES)) {
        if (timers.has(kind)) {
            continue;
        }
        runChecks(kind);
        timers.set(kind, setInterval(() => runChecks(kind), probe.intervalMs).unref());
    }
}

export function forgetInstanceChecks(instanceId) {
    for (const byInstance of failures.values()) {
        byInstance.delete(instanceId);
    }
    forgetInstanceHistory(instanceId);
}

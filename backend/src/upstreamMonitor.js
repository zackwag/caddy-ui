import { getInstances } from './instances.js';
import logger from './logger.js';
import { recordCheck } from './uptimeHistory.js';
import { checkInstanceUpstreams } from './upstreamChecks.js';

// Keeps uptime history populated continuously, independent of anyone having
// the dashboard open -- GET /api/health only records a check when a browser
// happens to poll it, which means history (and %uptime) previously only
// reflected periods someone was actively looking at the UI.
const CHECK_INTERVAL_MS = 30_000;

let timer = null;

async function checkAllInstances() {
    await Promise.all(getInstances().map(async (inst) => {
        let checks;
        try {
            checks = await checkInstanceUpstreams(inst.adminUrl);
        } catch (err) {
            logger.warn('Upstream monitor could not reach instance', { instance: inst.name, error: err.message });
            return;
        }
        for (const check of checks) recordCheck(inst.id, check.upstream, check.online);
    }));
}

export function startUpstreamMonitor() {
    if (timer) return;
    checkAllInstances();
    timer = setInterval(checkAllInstances, CHECK_INTERVAL_MS).unref();
}

import { getInstances } from './instances.js';
import logger from './logger.js';
import { recordCheck } from './uptimeHistory.js';
import { checkInstanceUpstreams, resultsByUpstream } from './upstreamChecks.js';

// The only recorder of upstream uptime history: one sample per upstream every
// CHECK_INTERVAL_MS, whether or not anyone has the UI open. GET /api/health
// runs live checks without recording them, so percentages weight time evenly.
export const CHECK_INTERVAL_MS = 30_000;

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
        for (const [upstream, online] of resultsByUpstream(checks)) recordCheck(inst.id, upstream, online);
    }));
}

export function startUpstreamMonitor() {
    if (timer) return;
    checkAllInstances();
    timer = setInterval(checkAllInstances, CHECK_INTERVAL_MS).unref();
}

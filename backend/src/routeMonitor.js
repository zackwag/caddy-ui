import { getInstances } from './instances.js';
import logger from './logger.js';
import { checkInstanceRoutes } from './routeChecks.js';
import { getSettings } from './settings.js';
import { recordCheck } from './uptimeHistory.js';

// Route checks send real requests through Caddy, so they show up in its
// access logs and request metrics. Run them far less often than upstream
// checks to keep that noise small.
export const ROUTE_CHECK_INTERVAL_MS = 5 * 60_000;

let timer = null;
let running = null;

async function checkAllInstances() {
    await Promise.all(getInstances().map(async (inst) => {
        let checks;
        try {
            checks = await checkInstanceRoutes(inst.adminUrl);
        } catch (err) {
            logger.warn('Route monitor could not reach instance', { instance: inst.name, error: err.message });
            return;
        }
        for (const check of checks) recordCheck(inst.id, check.host, check.online, 'route');
    }));
}

// Runs a round of checks unless one is already in flight. Also called when
// route checks are switched on so results show up without a 5 minute wait.
export function runRouteChecks() {
    if (!getSettings().routeChecks || running) return running;
    running = checkAllInstances().finally(() => { running = null; });
    return running;
}

export function startRouteMonitor() {
    if (timer) return;
    runRouteChecks();
    timer = setInterval(runRouteChecks, ROUTE_CHECK_INTERVAL_MS).unref();
}

import { createClaimReads } from './claimReads.js';
import { getInstances, instancesComplete } from './instances.js';
import logger from './logger.js';
import { getServers } from './observations.js';
import { claimUnassignedNotes, hasUnassignedNotes, pruneOrphanedNotes } from './routeNotes.js';

// Matches route notes to the instances serving their domains.

// Hosts an instance currently routes, from its live config; null when the
// config can't be read.
async function servedHosts(inst) {
    let servers;
    try {
        servers = await getServers(inst.adminUrl);
    } catch {
        return null;
    }
    const hosts = new Set();
    for (const server of Object.values(servers || {})) {
        for (const route of server.routes || []) {
            for (const host of route.match?.find(m => m.host)?.host || []) {
                hosts.add(host);
            }
        }
    }
    return hosts;
}

const reads = createClaimReads(servedHosts);
let claimsRunning = 0;

// Assigns notes saved before notes were per instance, if there are any. Run
// at startup and whenever an instance is saved. Configs are read outside the
// notes queue, so a hung instance doesn't hold up note edits. Nothing is
// assigned while an instance can't be read: retryNoteClaims tries again on
// that instance's next monitor round. Notes that were read and match nothing
// aren't retried.
export async function claimNotes({ onlyFailed = false } = {}) {
    claimsRunning++;
    try {
        // An ignored instances entry may serve a note's domain too
        if (!hasUnassignedNotes() || !instancesComplete()) {
            reads.clear();
            return;
        }
        const instances = getInstances();
        const hosts = await reads.readAll(instances, { onlyFailed });
        if (!hosts.includes(null)) {
            await claimUnassignedNotes(instances, hosts);
        }
    } catch (e) {
        logger.warn('Route notes could not be assigned', { error: e.message });
    } finally {
        claimsRunning--;
    }
}

// Called after an instance's monitor round: repeats the claim if that
// instance couldn't be read last time, re-reading only the ones that failed.
export function retryNoteClaims(instanceId) {
    if (reads.failed(instanceId) && !claimsRunning) {
        return claimNotes({ onlyFailed: true });
    }
}

// Runs once at startup: assigns notes saved before notes were per instance,
// then drops notes for domains their instance no longer serves.
export async function cleanupOrphanedNotes() {
    await claimNotes();
    try {
        const instances = getInstances();
        const hosts = await Promise.all(instances.map(servedHosts));
        await pruneOrphanedNotes(instances, hosts, { complete: instancesComplete() });
    } catch (e) {
        logger.warn(`Route notes cleanup failed`, { error: e.message });
    }
}

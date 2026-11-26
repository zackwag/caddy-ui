import { getInstances } from './instances.js';
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
            for (const host of route.match?.find(m => m.host)?.host || []) hosts.add(host);
        }
    }
    return hosts;
}

// Whether the last claim couldn't read every instance's config, so it's worth
// trying again, and how many claims are running.
let claimIncomplete = false;
let claimsRunning = 0;

// Assigns notes saved before notes were per instance, if there are any. Run
// at startup and whenever an instance is saved. A claim that couldn't read
// some instance is retried by retryNoteClaims; notes that were read and match
// nothing aren't.
export async function claimNotes() {
    claimsRunning++;
    let unreadable = false;
    const hostsFor = async inst => {
        const hosts = await servedHosts(inst);
        if (hosts === null) {
            unreadable = true;
        }
        return hosts;
    };
    try {
        if (hasUnassignedNotes()) {
            await claimUnassignedNotes(getInstances(), hostsFor);
        }
    } catch (e) {
        logger.warn('Route notes could not be assigned', { error: e.message });
    } finally {
        claimsRunning--;
    }
    claimIncomplete = unreadable;
}

// Called after monitor rounds: repeats a claim that couldn't read every
// instance, unless one is already running.
export function retryNoteClaims() {
    if (claimIncomplete && !claimsRunning) {
        return claimNotes();
    }
}

// Runs once at startup: assigns notes saved before notes were per instance,
// then drops notes for domains their instance no longer serves.
export async function cleanupOrphanedNotes() {
    await claimNotes();
    try {
        await pruneOrphanedNotes(getInstances(), servedHosts);
    } catch (e) {
        logger.warn(`Route notes cleanup failed`, { error: e.message });
    }
}

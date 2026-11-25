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

// Assigns notes saved before notes were per instance, if there are any.
export async function claimNotes() {
    if (await hasUnassignedNotes()) await claimUnassignedNotes(getInstances(), servedHosts);
}

// Runs once at startup: assigns notes saved before notes were per instance,
// then drops notes for domains their instance no longer serves.
export async function cleanupOrphanedNotes() {
    try {
        await claimNotes();
        await pruneOrphanedNotes(getInstances(), servedHosts);
    } catch (e) {
        logger.warn(`Route notes cleanup failed`, { error: e.message });
    }
}

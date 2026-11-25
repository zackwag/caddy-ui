import { randomUUID } from 'node:crypto';
import { getInstances } from './instances.js';
import { createJsonStore } from './jsonFile.js';
import logger from './logger.js';
import { getAuthentication } from './middleware/auth.js';

// Administrative actions that don't create a Caddyfile version. Caddyfile
// changes already carry their actor and outcome in configurationHistory.
export const AUDIT_ACTIONS = Object.freeze([
    'instance.add', 'instance.edit', 'instance.remove',
    'serverName.set', 'serverName.remove',
    'routeTitle.set',
    'notifications.configure',
    'history.delete',
]);
// Oldest events are dropped beyond this many.
export const AUDIT_LOG_LIMIT = 500;

const store = createJsonStore(process.env.AUDIT_LOG_PATH || '/etc/caddy-ui/audit-log.json',
    { parse: value => Array.isArray(value?.events) ? value : { events: [] } });

export const loadAuditLog = () => store.load();

// Records after the operation has settled. The actor comes from the
// authenticated request only. `details` must already be free of secrets and
// raw request bodies. Never throws: a lost event must not turn a completed
// change into a reported failure.
export async function recordAudit(req, { action, instanceId = null, instanceName, resource = null, details = {}, outcome = 'success' }) {
    try {
        if (!AUDIT_ACTIONS.includes(action)) throw new Error(`Unknown audit action: ${action}`);
        const actor = getAuthentication().getActor(req);
        const instance = instanceId != null ? { id: instanceId, name: instanceName ?? getInstances().find(entry => entry.id === instanceId)?.name ?? null } : null;
        const event = { id: randomUUID(), timestamp: new Date().toISOString(), action, outcome, actor, instance, resource, details };
        await store.update(state => {
            state.events.push(event);
            state.events.splice(0, Math.max(0, state.events.length - AUDIT_LOG_LIMIT));
        });
    } catch (error) {
        logger.warn('Administrative action could not be recorded', { action, instanceId, error: error.code || error.message });
    }
}

// Newest first. Names follow the current account, token and instance where
// they still exist; otherwise the name stored with the event is kept.
export function listAuditEvents() {
    const instances = new Map(getInstances().map(instance => [instance.id, instance.name]));
    return store.get().events.map(event => ({
        ...event,
        actor: event.actor && (getAuthentication().resolveActor(event.actor) || event.actor),
        instance: event.instance && { ...event.instance, name: instances.get(event.instance.id) ?? event.instance.name },
    })).reverse();
}

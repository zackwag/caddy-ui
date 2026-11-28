import { randomUUID } from 'node:crypto';
import { getInstances } from './instances.js';
import { createJsonStore } from './jsonFile.js';
import logger from './logger.js';

// Administrative actions that don't create a Caddyfile version. Caddyfile
// changes already carry their actor and outcome in configurationHistory.
const AUDIT_ACTIONS = Object.freeze([
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

// Never throws: a lost event must not turn a completed change into a reported
// failure.
async function recordAudit(actor, { action, instanceId = null, instanceName, resource = null, details = {}, outcome }) {
    try {
        if (!AUDIT_ACTIONS.includes(action)) {
            throw new Error(`Unknown audit action: ${action}`);
        }
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

// Runs an administrative operation and records how it settled, attributed to
// the authenticated request only. `details` must be free of secrets and raw
// request bodies; as a function it describes the operation's result, and a
// failure has none.
export async function audited(req, event, operation) {
    const { details } = event;
    const describe = typeof details === 'function';
    let result;
    try {
        result = await operation();
    } catch (error) {
        await recordAudit(req.actor ?? null, { ...event, ...(describe ? { details: {} } : {}), outcome: 'failure' });
        throw error;
    }
    await recordAudit(req.actor ?? null, { ...event, ...(describe ? { details: details(result) } : {}), outcome: 'success' });
    return result;
}

// Newest first. `resolveActor` gives an actor's current identity, if it still
// exists. Names follow the current account, token and instance where
// they still exist; otherwise the name stored with the event is kept.
export function listAuditEvents(resolveActor) {
    const instances = new Map(getInstances().map(instance => [instance.id, instance.name]));
    return store.get().events.map(event => ({
        ...event,
        actor: event.actor && (resolveActor(event.actor) || event.actor),
        instance: event.instance && { ...event.instance, name: instances.get(event.instance.id) ?? event.instance.name },
    })).reverse();
}

import { createJsonStore } from './jsonFile.js';
import { configurationHistory } from './configurationHistory.js';
import logger from './logger.js';

import { getAuthentication } from './middleware/auth.js';

const EVENTS_PATH = process.env.ADMIN_EVENTS_PATH || '/etc/caddy-ui/admin-events.json';
const EVENT_LIMIT = 200;

const VALID_ACTIONS = new Set([
    'instance.created', 'instance.updated', 'instance.removed',
    'server-name.set', 'server-name.removed',
    'route-note.set',
    'settings.updated',
    'notification-config.updated',
    'tls-certificate.deleted',
    'api-token.created', 'api-token.revoked',
    'caddyfile-history.deleted',
]);

const validActor = actor => actor && ['user', 'api-token'].includes(actor.type)
    && typeof actor.id === 'string' && /^[a-f0-9-]{32,36}$/.test(actor.id);

function normalize(input) {
    if (!input || !Array.isArray(input.events)) return { version: 1, events: [] };
    return { version: 1, events: input.events.filter(e => e && typeof e.timestamp === 'string' && typeof e.action === 'string') };
}

const store = createJsonStore(EVENTS_PATH, { parse: normalize, mode: 0o600 });

export async function loadAdminEvents() {
    return store.load();
}

// Record an administrative event. The actor's name is persisted in the shared
// identity registry so renames resolve at list time, not recording time.
// Callers use void (fire-and-forget), so failures are logged, never thrown.
export async function recordEvent(actor, { action, instanceId = null, resource, outcome = 'success', description }) {
    try {
        if (!VALID_ACTIONS.has(action)) {
            logger.warn('Unknown admin event action ignored', { action });
            return;
        }
        const reference = validActor(actor) ? { type: actor.type, id: actor.id } : null;
        if (actor && validActor(actor) && actor.name) {
            try { await configurationHistory.rememberActor(actor); } catch { /* best effort */ }
        }
        const event = {
            timestamp: new Date().toISOString(),
            action,
            actor: reference,
            instanceId,
            resource: resource ?? null,
            outcome,
            description: description ?? null,
        };
        await store.update(draft => {
            draft.events.unshift(event);
            if (draft.events.length > EVENT_LIMIT) draft.events.length = EVENT_LIMIT;
        });
        logger.info('Admin event recorded', { action, instanceId, resource, outcome });
    } catch (err) {
        logger.warn('Failed to record admin event', { action, error: err.message });
    }
}

export async function listEvents({ instanceId, limit = 50 } = {}) {
    const { events } = store.get();
    const identities = await configurationHistory.resolveActors();
    const filtered = instanceId !== undefined
        ? events.filter(e => e.instanceId === instanceId)
        : events;
    return filtered.slice(0, Math.min(limit, EVENT_LIMIT)).map(event => ({
        ...event,
        actor: event.actor
            ? identities[`${event.actor.type}:${event.actor.id}`] ?? { ...event.actor, name: null }
            : null,
    }));
}

// Convenience: resolves the actor from the request and records the event.
// Safe to call with void — never throws.
export function recordRequestEvent(req, eventFields) {
    let actor = null;
    try { actor = getAuthentication().getActor(req); } catch { /* auth not initialized in tests */ }
    void recordEvent(actor, eventFields);
}

export function forgetInstanceEvents(instanceId) {
    // Don't delete events — they're the audit trail of what happened,
    // including the removal itself. This is intentional.
}

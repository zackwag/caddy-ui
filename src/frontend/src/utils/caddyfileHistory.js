import { ERROR_MESSAGES } from './errorRegistry.js';

// Only a version's own author is known; an arbitrary comparison can span many
// saves. Keep attribution attached to each endpoint rather than to diff lines.
export function historyComparison(entry, entries) {
    return entry.parent && entries.some(candidate => candidate.filename === entry.parent) ? entry.parent : 'current';
}

export function historyActor(entry, t) {
    const actor = entry?.actor;
    if (!actor || typeof actor.name !== 'string' || !actor.name) return t('caddyfile.unknownActor');
    return t(actor.type === 'api-token' ? 'caddyfile.tokenActor' : 'caddyfile.userActor', { name: actor.name });
}

// A known warning code names what to check; anything else stays generic.
export function notifyConfigurationSave(toast, t, result, message) {
    if (!result?.warning) {
        toast.success(message);
        return;
    }
    const known = Object.hasOwn(ERROR_MESSAGES, result.warningCode);
    toast.info(t(known ? ERROR_MESSAGES[result.warningCode] : 'errors.operationWarning'), result);
}

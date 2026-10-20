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

export function notifyConfigurationSave(toast, t, result, message) {
    if (result?.warning) toast.info(t('errors.operationWarning'), result);
    else toast.success(message);
}

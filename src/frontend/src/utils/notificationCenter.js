// Notification policy is intentionally separate from diagnostics:
// recording an error never implies showing a toast.
export const MAX_VISIBLE_TOASTS = 4;
export const TOAST_DURATION_MS = 6000;

// A state error represents a continuing incident; an event represents one
// user action. Correlation IDs are intentionally NOT part of deduplication.
export function stateNotificationKey(scope, instanceId = '') {
    return `${scope}:${instanceId}`;
}

// Framework-independent store so duplicate suppression, recovery and timer
// behavior can be tested without rendering React.
export function createNotificationCenter({
    schedule = setTimeout,
    cancel = clearTimeout,
    durationMs = TOAST_DURATION_MS,
    maxVisible = MAX_VISIBLE_TOASTS,
} = {}) {
    let toasts = [];
    let sequence = 0;
    const incidents = new Set();
    const timers = new Map();
    const listeners = new Set();

    const publish = () => {
        for (const listener of listeners) listener();
    };
    const cancelToastTimer = id => {
        if (timers.has(id)) {
            cancel(timers.get(id));
            timers.delete(id);
        }
    };
    const dismiss = id => {
        if (!toasts.some(t => t.id === id)) return;
        toasts = toasts.filter(t => t.id !== id);
        cancelToastTimer(id);
        publish();
    };

    function notify(msg, type = 'info', diagnostic = null, policy = {}) {
        const mode = policy?.mode ?? 'event';
        const key = policy?.key;
        if (mode !== 'event' && mode !== 'state') {
            throw new TypeError('Notification mode must be event or state');
        }
        if (mode === 'state' && (typeof key !== 'string' || !key.trim())) {
            throw new TypeError('State notifications require a stable incident key');
        }
        if (mode === 'state') {
            if (incidents.has(key)) return false;
            incidents.add(key);
        }
        const toast = {
            id: String(++sequence), msg, type,
            code: diagnostic?.code || diagnostic?.warningCode || null,
            requestId: diagnostic?.requestId || null,
            ...(mode === 'state' ? { incidentKey: key } : {}),
        };
        toasts = [...toasts, toast];
        if (toasts.length > maxVisible) {
            const removed = toasts.slice(0, toasts.length - maxVisible);
            toasts = toasts.slice(-maxVisible);
            for (const old of removed) cancelToastTimer(old.id);
        }
        timers.set(toast.id, schedule(() => dismiss(toast.id), durationMs));
        publish();
        return true;
    }

    // Recovery rearms a state incident for future failures. No success toast
    // is emitted by default; the page's own status indicator remains authoritative.
    function recover(key, message = null) {
        if (!incidents.delete(key)) return false;
        const removed = toasts.filter(t => t.incidentKey === key);
        if (removed.length) {
            toasts = toasts.filter(t => t.incidentKey !== key);
            for (const toast of removed) cancelToastTimer(toast.id);
            publish();
        }
        if (message) notify(message, 'success');
        return true;
    }

    // Switching instances invalidates incident state, not user action toasts.
    function clearStates() {
        incidents.clear();
        const removed = toasts.filter(t => t.incidentKey);
        if (!removed.length) return;
        toasts = toasts.filter(t => !t.incidentKey);
        for (const toast of removed) cancelToastTimer(toast.id);
        publish();
    }

    function reset() {
        incidents.clear();
        for (const id of timers.keys()) cancelToastTimer(id);
        toasts = [];
        publish();
    }

    return {
        notify,
        recover,
        clearStates,
        reset,
        getSnapshot: () => toasts,
        subscribe: listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

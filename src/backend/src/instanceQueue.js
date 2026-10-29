// Runs operations on one instance's configuration one at a time, in order.
// Saves and drift checks share it, so neither observes the other mid-change.
// A failed operation doesn't stop the ones queued after it.
const pending = new Map();

export function runExclusive(instanceId, operation) {
    const queued = (pending.get(instanceId) || Promise.resolve()).catch(() => {}).then(operation);
    pending.set(instanceId, queued);
    const cleanup = () => {
        if (pending.get(instanceId) === queued) {
            pending.delete(instanceId);
        }
    };
    void queued.then(cleanup, cleanup);
    return queued;
}

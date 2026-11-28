// Keeps bursts bounded: the first event per key is delivered right away, and
// the rest of its cooldown is summarized in one delivery when it ends.
// `deliver(event, additional)` gets the latest event and how many it stands for
// beyond the first, 0 for an immediate delivery.
export function createDigest({ cooldownMs, deliver, onSummaryFailed }) {
    const batches = new Map();

    function forget(key) {
        clearTimeout(batches.get(key)?.timer);
        batches.delete(key);
    }

    return {
        add(key, event) {
            const pending = batches.get(key);
            if (pending) {
                pending.count++;
                pending.latest = event;
                return;
            }
            const batch = { count: 0, latest: event };
            batch.timer = setTimeout(() => {
                batches.delete(key);
                if (batch.count) void deliver(batch.latest, batch.count).catch(error => onSummaryFailed(batch.latest, error));
            }, cooldownMs());
            batch.timer.unref?.();
            batches.set(key, batch);
            return deliver(event, 0);
        },
        forget,
        clear() {
            for (const key of [...batches.keys()]) forget(key);
        },
    };
}

// Reads one thing from every instance to assign saved state whose owner isn't
// recorded, remembering whose read failed so a retry repeats only those. The
// read resolves to null when it fails.
export function createClaimReads(read) {
    // What the last read of each instance gave, kept only while a retry is due
    const results = new Map();
    const failed = new Set();
    return {
        // Each instance's result, null where its read failed. `onlyFailed`
        // reuses what earlier reads gave.
        async readAll(instances, { onlyFailed = false } = {}) {
            const ids = new Set(instances.map(instance => instance.id));
            for (const id of [...results.keys(), ...failed]) {
                if (!ids.has(id)) {
                    results.delete(id);
                    failed.delete(id);
                }
            }
            const values = await Promise.all(instances.map(async instance => {
                if (onlyFailed && results.has(instance.id)) {
                    return results.get(instance.id);
                }
                const result = await read(instance);
                if (result === null) {
                    failed.add(instance.id);
                    results.delete(instance.id);
                } else {
                    failed.delete(instance.id);
                    results.set(instance.id, result);
                }
                return result;
            }));
            if (!failed.size) {
                results.clear();
            }
            return values;
        },
        // Whether the instance's last read failed, so its next round should retry.
        failed: id => failed.has(id),
        // Nothing is left to assign, so nothing is retried.
        clear() {
            results.clear();
            failed.clear();
        },
    };
}

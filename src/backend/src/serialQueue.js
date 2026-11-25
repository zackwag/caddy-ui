// Runs operations one at a time, in order. A failed operation rejects its own
// caller but never the operations queued after it.
export function createSerialQueue() {
    let tail = Promise.resolve();
    return operation => {
        const result = tail.then(operation);
        tail = result.catch(() => {});
        return result;
    };
}

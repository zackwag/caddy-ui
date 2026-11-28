import { createSerialQueue } from './serialQueue.js';

// Runs operations on one instance's configuration one at a time, in order.
// Saves and drift checks share it, so neither observes the other mid-change.
const queues = new Map();

export function runExclusive(instanceId, operation) {
    if (!queues.has(instanceId)) {
        queues.set(instanceId, createSerialQueue());
    }
    return queues.get(instanceId)(operation);
}

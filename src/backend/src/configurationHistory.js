import { mkdir, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createCaddyfileHistory } from './caddyfileHistory.js';
import { DEFAULT_INSTANCE_ID, getInstances } from './instances.js';
import logger from './logger.js';

const HISTORY_PATH = process.env.HISTORY_PATH || '/etc/caddy-ui/history';

// Polling and management writes share one store and one identity registry.
export const configurationHistory = createCaddyfileHistory(HISTORY_PATH);

// Snapshots in the root of HISTORY_PATH belong to the 'default' instance. If
// the instances list no longer has one -- e.g. it was replaced by an instance
// added through the UI -- those snapshots would silently vanish from the UI.
// With exactly one instance they can only be its history, so move them into
// its folder; with several it's ambiguous, so leave them and say so. Pure so
// it's testable: returns the filenames to move into `targetId`'s folder.
export function planLegacyHistoryMigration(instances, rootFiles, targetFiles) {
    const legacy = rootFiles.filter(f => f.startsWith('Caddyfile-'));
    if (!legacy.length || instances.some(i => i.id === DEFAULT_INSTANCE_ID)) return null;
    if (instances.length !== 1) return { targetId: null, moves: [], orphaned: legacy.length };
    const existing = new Set(targetFiles);
    return { targetId: instances[0].id, moves: legacy.filter(f => !existing.has(f)), orphaned: 0 };
}

// Runs once at startup. Never deletes: snapshots past MAX_HISTORY are pruned
// by the next save, as usual.
export async function migrateLegacyHistory() {
    try {
        const rootFiles = await readdir(HISTORY_PATH).catch(() => []);
        const instances = getInstances();
        const targetId = instances.length === 1 ? instances[0].id : null;
        const targetFiles = targetId ? await readdir(configurationHistory.directory(targetId)).catch(() => []) : [];
        const plan = planLegacyHistoryMigration(instances, rootFiles, targetFiles);
        if (!plan) return;
        if (plan.orphaned) {
            logger.warn('Caddyfile snapshots from the old default instance were left in place: more than one instance exists, so it is unclear which one they belong to', { dir: HISTORY_PATH, count: plan.orphaned });
            return;
        }
        const dir = configurationHistory.directory(plan.targetId);
        await mkdir(dir, { recursive: true });
        for (const file of plan.moves) await rename(join(HISTORY_PATH, file), join(dir, file));
        logger.info('Moved Caddyfile snapshots from the old default instance', { instanceId: plan.targetId, count: plan.moves.length });
    } catch (err) {
        logger.warn('Failed to migrate Caddyfile history', { error: err.message });
    }
}

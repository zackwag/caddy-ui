import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import logger from './logger.js';

const HISTORY_PATH = process.env.UPTIME_HISTORY_PATH || '/etc/caddy-ui/uptime-history.json';
const RETENTION_DAYS = Number(process.env.UPTIME_HISTORY_RETENTION_DAYS) || 7;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const FLUSH_INTERVAL_MS = 60_000;

// key -> { entries: [{ online: boolean, at: epochMs }], firstSeen: epochMs }
const history = new Map();
let dirty = false;
let _writeLock = Promise.resolve();

// Upstream checks keep their original `<instance>:<upstream>` keys; route
// checks (keyed by site host) use `#` as the separator instead, which
// generated instance ids never contain, so the two never collide.
const KIND_SEPARATORS = { upstream: ':', route: '#' };

function historyKey(instanceId, target, kind = 'upstream') {
    return `${instanceId}${KIND_SEPARATORS[kind]}${target}`;
}

export async function initUptimeHistory() {
    try {
        const data = await readFile(HISTORY_PATH, 'utf8');
        const parsed = JSON.parse(data);
        for (const [key, entry] of Object.entries(parsed)) {
            history.set(key, { entries: entry.entries || [], firstSeen: entry.firstSeen });
        }
        logger.info('Loaded uptime history', { keys: history.size });
    } catch {
        // no existing history file -- start fresh
    }
    setInterval(flushIfDirty, FLUSH_INTERVAL_MS).unref();
}

function pruneOldEntries(entry, now) {
    const cutoff = now - RETENTION_MS;
    let i = 0;
    while (i < entry.entries.length && entry.entries[i].at < cutoff) i++;
    if (i > 0) entry.entries.splice(0, i);
}

export function recordCheck(instanceId, target, online, kind = 'upstream') {
    const key = historyKey(instanceId, target, kind);
    const now = Date.now();
    let entry = history.get(key);
    if (!entry) {
        entry = { entries: [], firstSeen: now };
        history.set(key, entry);
    }
    entry.entries.push({ online, at: now });
    pruneOldEntries(entry, now);
    dirty = true;
}

export function getUptimeStats(instanceId, target, kind = 'upstream') {
    const entry = history.get(historyKey(instanceId, target, kind));
    if (!entry || entry.entries.length === 0) return null;

    const total = entry.entries.length;
    const online = entry.entries.filter(e => e.online).length;
    const pct = Math.round((online / total) * 1000) / 10;
    const last = entry.entries[entry.entries.length - 1];
    const currentlyOnline = last.online;

    let streak = 0;
    for (let i = entry.entries.length - 1; i >= 0; i--) {
        if (entry.entries[i].online === currentlyOnline) streak++;
        else break;
    }
    const streakStart = entry.entries[entry.entries.length - streak].at;
    const streakSeconds = Math.max(0, Math.round((Date.now() - streakStart) / 1000));
    const streakLabel = formatDuration(streakSeconds);

    return { pct, total, online, currentlyOnline, streak, streakSeconds, streakLabel, firstSeen: new Date(entry.firstSeen), lastCheckAt: new Date(last.at) };
}

// Returns every upstream's (or route's) stats for one instance, keyed by bare
// target (not the internal instance-prefixed key) -- what the routes table wants.
export function getStatsForInstance(instanceId, kind = 'upstream') {
    const prefix = historyKey(instanceId, '', kind);
    const stats = {};
    for (const key of history.keys()) {
        if (!key.startsWith(prefix)) continue;
        const target = key.slice(prefix.length);
        stats[target] = getUptimeStats(instanceId, target, kind);
    }
    return stats;
}

// Raw timestamped checks for the history modal's timeline, optionally
// trimmed to entries at or after sinceMs.
export function getHistory(instanceId, target, { sinceMs, kind = 'upstream' } = {}) {
    const entry = history.get(historyKey(instanceId, target, kind));
    if (!entry) return { entries: [], firstSeen: null };
    const entries = sinceMs ? entry.entries.filter(e => e.at >= sinceMs) : entry.entries;
    return { entries, firstSeen: entry.firstSeen };
}

export function formatDuration(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${seconds}s`;
}

async function flushIfDirty() {
    if (!dirty) return;
    dirty = false;
    await flush();
}

async function flush() {
    const obj = {};
    for (const [key, entry] of history) obj[key] = entry;
    _writeLock = _writeLock.then(async () => {
        try {
            await mkdir(dirname(HISTORY_PATH), { recursive: true });
            await writeFile(HISTORY_PATH, JSON.stringify(obj), 'utf8');
        } catch (err) {
            logger.warn('Failed to persist uptime history', { error: err.message });
        }
    });
    return _writeLock;
}

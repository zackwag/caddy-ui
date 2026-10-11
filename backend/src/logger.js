const isDev = process.env.NODE_ENV !== 'production';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? 1;
const MAX_RECENT_ENTRIES = 500;
const recentEntries = [];
const subscribers = new Set();

function timestamp() {
    return new Date().toISOString();
}

function log(level, message, meta = {}) {
    if (LEVELS[level] < minLevel) return;
    const entry = { ts: timestamp(), level, message, ...meta };
    recentEntries.push(entry);
    if (recentEntries.length > MAX_RECENT_ENTRIES) recentEntries.shift();
    for (const subscriber of subscribers) {
        try {
            subscriber(entry);
        } catch {
            // A disconnected log viewer must never break application logging.
        }
    }

    if (isDev) {
        const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
        console.log(`[${entry.ts}] ${level.toUpperCase().padEnd(5)} ${message}${metaStr}`);
    } else {
        console.log(JSON.stringify(entry));
    }
}

export function getRecentLogEntries(limit = MAX_RECENT_ENTRIES) {
    const count = Math.max(0, Math.min(Number(limit) || 0, MAX_RECENT_ENTRIES));
    return recentEntries.slice(-count);
}

export function subscribeToLogs(subscriber) {
    subscribers.add(subscriber);
    return () => subscribers.delete(subscriber);
}

export const logger = {
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
    debug: (message, meta) => log('debug', message, meta),
};

export default logger;

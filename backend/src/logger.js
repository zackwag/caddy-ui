const isDev = process.env.NODE_ENV !== 'production';

function timestamp() {
    return new Date().toISOString();
}

function log(level, message, meta = {}) {
    const entry = { ts: timestamp(), level, message, ...meta };
    if (isDev) {
        const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
        console.log(`[${entry.ts}] ${level.toUpperCase().padEnd(5)} ${message}${metaStr}`);
    } else {
        console.log(JSON.stringify(entry));
    }
}

export const logger = {
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
    debug: (message, meta) => log('debug', message, meta),
};

export default logger;

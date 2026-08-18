import { createConnection } from 'net';
import { X509Certificate } from 'crypto';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { CADDY_ADMIN_URL, caddyGet } from './caddy.js';
import logger from './logger.js';

const CADDY_DATA_PATH = process.env.CADDY_DATA_PATH || '/data/caddy/caddy';
const CERTS_PATH = join(CADDY_DATA_PATH, 'certificates');
const CHECK_INTERVAL_MS = 30_000;
const TIMEOUT_MS = 3000;

let config = null;
let checkTimer = null;
const debounceMap = new Map(); // key -> last alert timestamp

export function updateMonitorConfig(newConfig) {
    config = newConfig;
    if (config.enabled && !checkTimer) {
        startMonitor();
    } else if (!config.enabled && checkTimer) {
        stopMonitor();
    }
}

function startMonitor() {
    logger.info('Notification monitor started');
    checkTimer = setInterval(runChecks, CHECK_INTERVAL_MS);
    runChecks();
}

function stopMonitor() {
    if (checkTimer) {
        clearInterval(checkTimer);
        checkTimer = null;
    }
    logger.info('Notification monitor stopped');
}

function isDebouncedKey(key) {
    const last = debounceMap.get(key);
    if (!last) return false;
    const windowMs = (config?.debounceMinutes || 30) * 60 * 1000;
    return Date.now() - last < windowMs;
}

function markSent(key) {
    debounceMap.set(key, Date.now());
}

async function runChecks() {
    if (!config?.enabled) return;

    try {
        if (config.triggers.upstreamOffline || config.triggers.upstreamOnline) {
            await checkUpstreams();
        }
        if (config.triggers.certExpiring) {
            await checkCerts();
        }
    } catch (err) {
        logger.error('Notification monitor check failed', { error: err.message });
    }
}

// Track previous upstream state to detect transitions
const upstreamState = new Map(); // upstream -> boolean (online)

async function checkUpstreams() {
    let servers;
    try {
        servers = await caddyGet('/config/apps/http/servers');
    } catch {
        return;
    }

    const checks = [];
    for (const [, server] of Object.entries(servers || {})) {
        for (const route of server.routes || []) {
            const domain = route.match?.find(m => m.host)?.host?.[0] || null;
            const upstreams = extractUpstreams(route);
            for (const upstream of upstreams) {
                const [host, port] = upstream.split(':');
                if (host && port) checks.push({ domain, upstream, host, port });
            }
        }
    }

    let caddyPool = {};
    try {
        const poolRes = await fetch(`${CADDY_ADMIN_URL}/reverse_proxy/upstreams`, {
            headers: { 'Origin': 'http://0.0.0.0:2019' },
        });
        if (poolRes.ok) {
            const pool = await poolRes.json();
            for (const entry of pool) {
                if (entry.address) caddyPool[entry.address] = entry;
            }
        }
    } catch { }

    for (const check of checks) {
        let online;
        if (check.upstream in caddyPool) {
            online = caddyPool[check.upstream].fails === 0;
        } else {
            online = await checkTCP(check.host, check.port);
        }

        const prev = upstreamState.get(check.upstream);
        upstreamState.set(check.upstream, online);

        if (prev === undefined) continue; // first check, no transition

        const label = check.domain ? `${check.domain} (${check.upstream})` : check.upstream;

        if (prev && !online && config.triggers.upstreamOffline) {
            const key = `offline:${check.upstream}`;
            if (!isDebouncedKey(key)) {
                markSent(key);
                await sendNotification(config, {
                    title: 'Upstream offline',
                    message: `${label} is unreachable`,
                    priority: 'high',
                });
            }
        }

        if (!prev && online && config.triggers.upstreamOnline) {
            const key = `online:${check.upstream}`;
            if (!isDebouncedKey(key)) {
                markSent(key);
                await sendNotification(config, {
                    title: 'Upstream recovered',
                    message: `${label} is back online`,
                    priority: 'default',
                });
            }
        }
    }
}

async function checkCerts() {
    let issuers;
    try {
        issuers = await readdir(CERTS_PATH);
    } catch {
        return;
    }

    for (const issuer of issuers) {
        if (issuer === 'local') continue;
        const issuerPath = join(CERTS_PATH, issuer);
        let domains;
        try {
            domains = await readdir(issuerPath);
        } catch {
            continue;
        }

        for (const domain of domains) {
            const certFile = join(issuerPath, domain, `${domain}.crt`);
            try {
                const pem = await readFile(certFile, 'utf8');
                const cert = new X509Certificate(pem);
                const validTo = new Date(cert.validTo);
                const daysRemaining = Math.floor((validTo - Date.now()) / (1000 * 60 * 60 * 24));

                if (daysRemaining <= 14 && daysRemaining >= 0) {
                    const key = `cert-expiring:${domain}`;
                    if (!isDebouncedKey(key)) {
                        markSent(key);
                        await sendNotification(config, {
                            title: 'Certificate expiring',
                            message: `${domain} expires in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`,
                            priority: 'high',
                        });
                    }
                }
            } catch {
                continue;
            }
        }
    }
}

function extractUpstreams(route) {
    const results = [];
    function walk(handles) {
        for (const h of handles || []) {
            if (h.handler === 'reverse_proxy' && h.upstreams) {
                for (const u of h.upstreams) if (u.dial) results.push(u.dial);
            }
            if (h.routes) for (const r of h.routes) walk(r.handle);
        }
    }
    walk(route.handle);
    return results;
}

function checkTCP(host, port) {
    return new Promise((resolve) => {
        const socket = createConnection({ host, port: parseInt(port), timeout: TIMEOUT_MS });
        const timer = setTimeout(() => { socket.destroy(); resolve(false); }, TIMEOUT_MS);
        socket.on('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
        socket.on('error', () => { clearTimeout(timer); resolve(false); });
        socket.on('timeout', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
    });
}

export async function sendNotification(cfg, { title, message, priority }) {
    const provider = cfg.provider;

    if (provider === 'ntfy') {
        if (!cfg.ntfy?.url) throw new Error('ntfy URL not configured');
        const res = await fetch(cfg.ntfy.url, {
            method: 'POST',
            headers: {
                'Title': title,
                'Priority': priority || 'default',
            },
            body: message,
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`ntfy responded ${res.status}: ${text}`);
        }
        logger.info('Notification sent via ntfy', { title });

    } else if (provider === 'discord') {
        if (!cfg.discord?.webhookUrl) throw new Error('Discord webhook URL not configured');
        const color = priority === 'high' ? 0xff4d6a : 0x00e5a0;
        const res = await fetch(cfg.discord.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title,
                    description: message,
                    color,
                    timestamp: new Date().toISOString(),
                    footer: { text: 'caddy/ui' },
                }],
            }),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Discord responded ${res.status}: ${text}`);
        }
        logger.info('Notification sent via Discord', { title });

    } else if (provider === 'slack') {
        if (!cfg.slack?.webhookUrl) throw new Error('Slack webhook URL not configured');
        const emoji = priority === 'high' ? ':rotating_light:' : ':white_check_mark:';
        const res = await fetch(cfg.slack.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: `${emoji} *${title}*\n${message}`,
            }),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Slack responded ${res.status}: ${text}`);
        }
        logger.info('Notification sent via Slack', { title });

    } else if (provider === 'pushover') {
        if (!cfg.pushover?.userKey || !cfg.pushover?.apiToken) throw new Error('Pushover user key and API token required');
        const pushPriority = priority === 'high' ? 1 : 0;
        const res = await fetch('https://api.pushover.net/1/messages.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: cfg.pushover.apiToken,
                user: cfg.pushover.userKey,
                title,
                message,
                priority: pushPriority,
            }),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Pushover responded ${res.status}: ${text}`);
        }
        logger.info('Notification sent via Pushover', { title });

    } else if (provider === 'custom') {
        if (!cfg.custom?.url) throw new Error('Custom webhook URL not configured');
        const res = await fetch(cfg.custom.url, {
            method: cfg.custom.method || 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, message, priority, timestamp: new Date().toISOString() }),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Custom webhook responded ${res.status}: ${text}`);
        }
        logger.info('Notification sent via custom webhook', { title });

    } else {
        throw new Error(`Unknown provider: ${provider}`);
    }
}

export async function initMonitor() {
    try {
        const { loadConfig } = await import('./routes/notifications.js');
        config = await loadConfig();
        if (config.enabled) startMonitor();
    } catch (err) {
        logger.warn('Could not load notification config on startup', { error: err.message });
    }
}

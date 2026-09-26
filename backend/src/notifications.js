import { createConnection, isIP } from 'net';
import { X509Certificate } from 'crypto';
import { join } from 'path';
import { listContainerDir, readContainerFile } from './containerFs.js';
import { promises as dns } from 'dns';
import { caddyGet } from './caddy.js';
import { getInstances } from './instances.js';
import logger from './logger.js';
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
    for (const inst of getInstances()) {
        let servers;
        try {
            servers = await caddyGet('/config/apps/http/servers', inst.adminUrl);
        } catch {
            continue;
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
            const poolRes = await fetch(`${inst.adminUrl}/reverse_proxy/upstreams`, {
                headers: { 'Origin': 'http://0.0.0.0:2019' },
                signal: AbortSignal.timeout(3000),
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

            const stateKey = `${inst.id}:${check.upstream}`;
            const prev = upstreamState.get(stateKey);
            upstreamState.set(stateKey, online);

            if (prev === undefined) continue;

            const instLabel = getInstances().length > 1 ? `[${inst.name}] ` : '';
            const label = check.domain ? `${instLabel}${check.domain} (${check.upstream})` : `${instLabel}${check.upstream}`;

            if (prev && !online && config.triggers.upstreamOffline) {
                const key = `offline:${stateKey}`;
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
                const key = `online:${stateKey}`;
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
}

async function checkCerts() {
    for (const inst of getInstances()) {
        const certsPath = join(inst.dataPath, 'certificates');
        const issuers = await listContainerDir(inst.containerName, certsPath);
        if (!issuers.length) continue;

        for (const issuer of issuers) {
            if (issuer === 'local') continue;
            const issuerPath = join(certsPath, issuer);
            const domains = await listContainerDir(inst.containerName, issuerPath);
            if (!domains.length) continue;

            for (const domain of domains) {
                const certFile = join(issuerPath, domain, `${domain}.crt`);
                try {
                    const pem = await readContainerFile(inst.containerName, certFile);
                    const cert = new X509Certificate(pem);
                    const validTo = new Date(cert.validTo);
                    const daysRemaining = Math.floor((validTo - Date.now()) / (1000 * 60 * 60 * 24));

                    if (daysRemaining <= 14 && daysRemaining >= 0) {
                        const key = `cert-expiring:${inst.id}:${domain}`;
                        if (!isDebouncedKey(key)) {
                            markSent(key);
                            const instLabel = getInstances().length > 1 ? `[${inst.name}] ` : '';
                            await sendNotification(config, {
                                title: 'Certificate expiring',
                                message: `${instLabel}${domain} expires in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`,
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

function isUnsafeIPv4(ip) {
    const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    return a === 0
        || a === 10
        || a === 127
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || a >= 224;
}

function isUnsafeIPv6(ip) {
    const normalized = ip.toLowerCase();
    return normalized === '::'
        || normalized === '::1'
        || normalized.startsWith('fe80:')
        || normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('ff');
}

function isUnsafeIpAddress(ip) {
    const version = isIP(ip);
    if (version === 4) return isUnsafeIPv4(ip);
    if (version === 6) return isUnsafeIPv6(ip);
    return true;
}

async function validateWebhookUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid webhook URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Webhook URL must use http or https: ${url}`);
    }

    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host === 'metadata.google.internal') {
        throw new Error(`Webhook URL must not target internal/private addresses: ${host}`);
    }

    if (isIP(host) && isUnsafeIpAddress(host)) {
        throw new Error(`Webhook URL must not target internal/private addresses: ${host}`);
    }

    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length) {
        throw new Error(`Webhook URL host does not resolve: ${host}`);
    }
    if (records.some((r) => isUnsafeIpAddress(r.address))) {
        throw new Error(`Webhook URL must not resolve to internal/private addresses: ${host}`);
    }

    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${host}${port}${parsed.pathname}${parsed.search}`;
}

async function sanitizeWebhookUrl(url) {
    const validated = await validateWebhookUrl(url);
    const m = /^(https?):\/\/([a-zA-Z0-9][a-zA-Z0-9._:-]*)(\/[^\s]*)?$/.exec(validated);
    if (!m) throw new Error('Invalid webhook URL');
    return `${m[1]}://${m[2]}${m[3] || '/'}`;
}

export async function sendNotification(cfg, { title, message, priority }) {
    const provider = cfg.provider;

    if (provider === 'ntfy') {
        if (!cfg.ntfy?.url) throw new Error('ntfy URL not configured');
        const ntfyUrl = await sanitizeWebhookUrl(cfg.ntfy.url);
        const res = await fetch(ntfyUrl, {
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
        const discordUrl = await sanitizeWebhookUrl(cfg.discord.webhookUrl);
        const color = priority === 'high' ? 0xff4d6a : 0x00e5a0;
        const res = await fetch(discordUrl, {
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
        const slackUrl = await sanitizeWebhookUrl(cfg.slack.webhookUrl);
        const emoji = priority === 'high' ? ':rotating_light:' : ':white_check_mark:';
        const res = await fetch(slackUrl, {
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
        const customUrl = await sanitizeWebhookUrl(cfg.custom.url);
        const res = await fetch(customUrl, {
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

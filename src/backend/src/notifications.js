import { X509Certificate } from 'crypto';
import { join } from 'path';
import { listContainerDir, readContainerFile } from './containerFs.js';
import { getInstances } from './instances.js';
import logger from './logger.js';
import { failureReason } from './routeChecks.js';
import { getUpdateNotification } from './updateCheck.js';
import { checkInstanceUpstreams } from './upstreamChecks.js';
import { sendWebhook } from './webhookTransport.js';
const CHECK_INTERVAL_MS = 30_000;

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
        // Missing from configs saved before this trigger existed; on by default
        if (config.triggers.updateAvailable !== false) {
            await checkForUpdate();
        }
    } catch (err) {
        logger.error('Notification monitor check failed', { error: err.message });
    }
}

// Each caddy/ui release notifies once (per process), rather than repeating
// every debounce window like outage alerts
const notifiedUpdates = new Set();

async function checkForUpdate() {
    const notification = getUpdateNotification();
    if (!notification || notifiedUpdates.has(notification.key)) return;
    notifiedUpdates.add(notification.key);
    await sendNotification(config, { title: notification.title, message: notification.message, priority: 'default' });
}

// Track previous upstream state to detect transitions
const upstreamState = new Map(); // upstream -> boolean (online)

// Prefixes a notification message with the instance name, but only when there's
// more than one instance configured -- no point labeling in the common case.
function instanceLabel(inst) {
    return getInstances().length > 1 ? `[${inst.name}] ` : '';
}

async function checkUpstreams() {
    await Promise.all(getInstances().map(checkUpstreamsForInstance));
}

async function checkUpstreamsForInstance(inst) {
    let checks;
    try {
        checks = await checkInstanceUpstreams(inst.adminUrl);
    } catch {
        return;
    }

    for (const check of checks) {
        const online = check.online;
        const stateKey = `${inst.id}:${check.upstream}`;
        const prev = upstreamState.get(stateKey);
        upstreamState.set(stateKey, online);

        if (prev === undefined) continue;

        const instLabel = instanceLabel(inst);
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

// Last known route check result per `<instance>#<host>`. Fed by the route
// monitor after each round rather than by probes of our own, so alerting
// doesn't add more requests through Caddy.
const routeState = new Map();

// Records one instance's round of route checks and returns the checks whose
// online state changed since the previous round. Hosts missing from this
// round (skipped, removed from the config) are forgotten, so they don't fire
// a stale transition if they come back later.
export function routeTransitions(state, instanceId, checks) {
    const prefix = `${instanceId}#`;
    const seen = new Set();
    const changes = [];
    for (const check of checks) {
        const key = prefix + check.host;
        seen.add(key);
        const prev = state.get(key);
        state.set(key, check.online);
        if (prev !== undefined && prev !== check.online) changes.push(check);
    }
    for (const key of [...state.keys()]) {
        if (key.startsWith(prefix) && !seen.has(key)) state.delete(key);
    }
    return changes;
}

// Called by the route monitor with each instance's results. State is tracked
// even while notifications are off so enabling them later compares against
// the latest round instead of alerting on everything.
export async function notifyRouteChecks(inst, checks) {
    const changes = routeTransitions(routeState, inst.id, checks);
    if (!config?.enabled) return;

    const instLabel = instanceLabel(inst);
    for (const check of changes) {
        const stateKey = `${inst.id}#${check.host}`;
        if (!check.online && config.triggers?.routeOffline) {
            const key = `route-offline:${stateKey}`;
            if (isDebouncedKey(key)) continue;
            markSent(key);
            await sendNotification(config, {
                title: 'Route down',
                message: `${instLabel}${check.host} is down: ${failureReason(check)}`,
                priority: 'high',
            });
        }
        if (check.online && config.triggers?.routeOnline) {
            const key = `route-online:${stateKey}`;
            if (isDebouncedKey(key)) continue;
            markSent(key);
            await sendNotification(config, {
                title: 'Route recovered',
                message: `${instLabel}${check.host} is back up`,
                priority: 'default',
            });
        }
    }
}

async function checkCerts() {
    await Promise.all(getInstances().map(checkCertsForInstance));
}

async function checkCertsForInstance(inst) {
    const certsPath = join(inst.dataPath, 'certificates');
    const issuers = await listContainerDir(inst.containerName, certsPath);
    if (!issuers.length) return;

    const instLabel = instanceLabel(inst);
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

export async function sendNotification(cfg, { title, message, priority }) {
    const provider = cfg.provider;

    if (provider === 'ntfy') {
        if (!cfg.ntfy?.url) throw new Error('ntfy URL not configured');
        await sendWebhook(cfg.ntfy.url, {
            name: 'ntfy',
            headers: {
                'Title': title,
                'Priority': priority || 'default',
                'Content-Type': 'text/plain; charset=utf-8',
            },
            body: message,
        });
        logger.info('Notification sent via ntfy', { title });

    } else if (provider === 'discord') {
        if (!cfg.discord?.webhookUrl) throw new Error('Discord webhook URL not configured');
        const color = priority === 'high' ? 0xff4d6a : 0x00e5a0;
        await sendWebhook(cfg.discord.webhookUrl, {
            name: 'Discord',
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
        logger.info('Notification sent via Discord', { title });

    } else if (provider === 'slack') {
        if (!cfg.slack?.webhookUrl) throw new Error('Slack webhook URL not configured');
        const emoji = priority === 'high' ? ':rotating_light:' : ':white_check_mark:';
        await sendWebhook(cfg.slack.webhookUrl, {
            name: 'Slack',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: `${emoji} *${title}*\n${message}`,
            }),
        });
        logger.info('Notification sent via Slack', { title });

    } else if (provider === 'pushover') {
        if (!cfg.pushover?.userKey || !cfg.pushover?.apiToken) throw new Error('Pushover user key and API token required');
        const pushPriority = priority === 'high' ? 1 : 0;
        await sendWebhook('https://api.pushover.net/1/messages.json', {
            name: 'Pushover',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: cfg.pushover.apiToken,
                user: cfg.pushover.userKey,
                title,
                message,
                priority: pushPriority,
            }),
        });
        logger.info('Notification sent via Pushover', { title });

    } else if (provider === 'custom') {
        if (!cfg.custom?.url) throw new Error('Custom webhook URL not configured');
        await sendWebhook(cfg.custom.url, {
            name: 'Custom webhook',
            method: cfg.custom.method || 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, message, priority, timestamp: new Date().toISOString() }),
        });
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

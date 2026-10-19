import { X509Certificate } from 'crypto';
import { join } from 'path';
import { describeReadError, listContainerDir, readContainerDir, readContainerFile } from './containerFs.js';
import { getInstances } from './instances.js';
import logger from './logger.js';
import { failureReason } from './routeChecks.js';
import { getUpdateNotification } from './updateCheck.js';
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
    checkTimer = setInterval(runNotificationCycle, CHECK_INTERVAL_MS);
    runNotificationCycle();
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

async function runNotificationCycle() {
    if (!config?.enabled) return;

    const categories = [];
    if (config.triggers.certExpiring) {
        categories.push({ category: 'certificates', check: checkCerts });
    }
    if (config.triggers.updateAvailable !== false) {
        categories.push({ category: 'updates', check: checkForUpdate });
    }
    if (config.triggers.apiTokenExpiring !== false) {
        categories.push({ category: 'api-tokens', check: () => notifyExpiringApiTokens(listApiTokens()) });
    }

    const results = await Promise.allSettled(categories.map(c => c.check()));
    for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'rejected') {
            logger.error('Notification monitor check failed', {
                category: categories[i].category,
                error: results[i].reason?.message ?? String(results[i].reason),
            });
        }
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

const DAY_MS = 86_400_000;

// API tokens alert once each when this much of their lifetime is left. Tokens
// issued for no longer than this are short-lived on purpose and skipped, or
// they'd alert as soon as they were created.
const TOKEN_EXPIRY_WINDOW_MS = 7 * DAY_MS;

// Each token notifies once (per process), like releases: it can't recover
// the way an upstream can, so repeating every debounce window would only nag.
const notifiedTokens = new Set();

// Token metadata (no secrets) from the auth service, supplied by initMonitor.
let listApiTokens = () => [];

export async function notifyExpiringApiTokens(tokens, now = Date.now()) {
    for (const token of tokens) {
        const expiresAt = Date.parse(token.expiresAt);
        const remaining = expiresAt - now;
        if (remaining <= 0 || remaining > TOKEN_EXPIRY_WINDOW_MS) continue;
        if (expiresAt - Date.parse(token.createdAt) <= TOKEN_EXPIRY_WINDOW_MS) continue;
        if (notifiedTokens.has(token.id)) continue;
        // Reserve pending deliveries too, so overlapping checks cannot duplicate them.
        notifiedTokens.add(token.id);
        try {
            const days = Math.ceil(remaining / DAY_MS);
            await sendNotification(config, {
                title: 'API token expiring',
                message: `API token "${token.name}" expires in ${days} day${days !== 1 ? 's' : ''} (${new Date(expiresAt).toISOString().slice(0, 10)})`,
                priority: 'high',
            });
        } catch (err) {
            notifiedTokens.delete(token.id);
            throw err;
        }
    }
}

// Track previous upstream state to detect transitions
const upstreamState = new Map(); // upstream -> boolean (online)

// Prefixes a notification message with the instance name, but only when there's
// more than one instance configured -- no point labeling in the common case.
function instanceLabel(inst) {
    return getInstances().length > 1 ? `[${inst.name}] ` : '';
}

// Fed by the upstream monitor after each round rather than by probes of our
// own, like notifyRouteChecks. State is tracked while notifications are off
// too, so turning them on compares against the current state, not a stale one.
export async function notifyUpstreamChecks(inst, checks) {
    const changes = [];
    for (const check of checks) {
        const stateKey = `${inst.id}:${check.upstream}`;
        const prev = upstreamState.get(stateKey);
        upstreamState.set(stateKey, check.online);
        if (prev !== undefined && prev !== check.online) changes.push(check);
    }
    if (!config?.enabled) return;

    const instLabel = instanceLabel(inst);
    for (const check of changes) {
        const stateKey = `${inst.id}:${check.upstream}`;
        const label = check.domain ? `${instLabel}${check.domain} (${check.upstream})` : `${instLabel}${check.upstream}`;

        try {
            if (!check.online && config.triggers.upstreamOffline) {
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

            if (check.online && config.triggers.upstreamOnline) {
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
        } catch (err) {
            logger.warn('Upstream notification failed', {
                instance: inst.name,
                upstream: check.upstream,
                error: err.message,
            });
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

// Instances whose certificate storage couldn't be read on the last check, so
// the failure is logged once per outage rather than on every check.
const certReadFailures = new Set();

// Unreadable storage means expiry alerts can't be sent, so it's logged rather
// than treated as "no certificates". A missing path just means Caddy hasn't
// stored a certificate yet; it only creates its data directory when it does.
async function readCertIssuers(inst, certsPath) {
    try {
        const issuers = await readContainerDir(inst.containerName, certsPath);
        if (certReadFailures.delete(inst.id)) logger.info('Certificate expiry checks resumed', { instance: inst.name });
        return issuers;
    } catch (err) {
        const reason = describeReadError(err);
        if (reason === 'not found') {
            if (certReadFailures.delete(inst.id)) logger.info('Certificate expiry checks resumed', { instance: inst.name });
            return [];
        }
        if (!certReadFailures.has(inst.id)) {
            certReadFailures.add(inst.id);
            logger.warn('Certificate expiry checks skipped: certificates could not be read', { instance: inst.name, path: certsPath, reason });
        }
        return [];
    }
}

export async function checkCertsForInstance(inst) {
    const certsPath = join(inst.dataPath, 'certificates');
    const issuers = await readCertIssuers(inst, certsPath);
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

export async function initMonitor({ apiTokens } = {}) {
    if (apiTokens) listApiTokens = apiTokens;
    try {
        const { loadConfig } = await import('./routes/notifications.js');
        config = await loadConfig();
        if (config.enabled) startMonitor();
    } catch (err) {
        logger.warn('Could not load notification config on startup', { error: err.message });
    }
}

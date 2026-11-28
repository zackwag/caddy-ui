import { isPasswordFallback, onAuthenticationEvent } from './authEvents.js';
import { certificateName, listCertificates } from './certificates.js';
import { getInstances } from './instances.js';
import logger from './logger.js';
import { debounceMs, getNotificationConfig, loadNotificationConfig, onNotificationConfigChange } from './notificationConfig.js';
import { sendNotification } from './notificationDelivery.js';
import { createDigest } from './notificationDigest.js';
import { getUpdateNotification } from './updateCheck.js';

// Certificates, releases and tokens change over days, not seconds.
const REMINDER_INTERVAL_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

let reminderTimer = null;
let listApiTokens = () => [];
// instance id -> alert -> when it was last delivered
const debounced = new Map();

const cooldownMs = () => debounceMs(getNotificationConfig());

const enabled = trigger => {
    const config = getNotificationConfig();
    return config.enabled && config.triggers[trigger];
};

function isDebounced(instanceId, alert) {
    const last = debounced.get(instanceId)?.get(alert);
    return last !== undefined && Date.now() - last < cooldownMs();
}

function debounce(instanceId, alert) {
    if (!debounced.has(instanceId)) {
        debounced.set(instanceId, new Map());
    }
    debounced.get(instanceId).set(alert, Date.now());
}

function forgetExpiredDebounces() {
    for (const [instanceId, alerts] of debounced) {
        for (const alert of alerts.keys()) {
            if (!isDebounced(instanceId, alert)) {
                alerts.delete(alert);
            }
        }
        if (!alerts.size) {
            debounced.delete(instanceId);
        }
    }
}

function instanceLabel(inst) {
    return getInstances().length > 1 ? `[${inst.name}] ` : '';
}

// --- Authentication ---------------------------------------------------------

// Three failure buckets (password, passkey, recovery), independent of client IP.
// Successes are never debounced. Delivery is best effort, with bounded concurrency.
const MAX_AUTHENTICATION_DELIVERIES = 8;
let authenticationDeliveries = 0;
let authenticationBusyReported = false;

const AUTHENTICATION_NAMES = { recovery: 'Account recovery', totp: 'Authenticator sign-in', 'password-totp': 'Password and authenticator sign-in', password: 'Password sign-in', passkey: 'Passkey sign-in' };

function authenticationTitle(event) {
    if (isPasswordFallback(event)) {
        return 'Password sign-in while passkeys are configured';
    }
    return `${AUTHENTICATION_NAMES[event.method]} ${event.outcome === 'success' ? 'succeeded' : 'failed'}`;
}

function authenticationPriority(event) {
    return event.method === 'recovery' || isPasswordFallback(event) ? 'high' : 'default';
}

async function deliverAuthentication(event, additional = 0) {
    if (!enabled('authentication')) {
        return;
    }
    if (authenticationDeliveries >= MAX_AUTHENTICATION_DELIVERIES) {
        if (!authenticationBusyReported) {
            authenticationBusyReported = true;
            logger.warn('Authentication notification skipped: delivery capacity reached');
        }
        return;
    }
    authenticationDeliveries++;
    try {
        const message = additional
            ? `${additional} additional failed ${event.method} attempts during the cooldown. Latest attempt: ${event.timestamp}. Latest source IP: ${event.sourceIp}.`
            : `Time: ${event.timestamp}\nMethod: ${event.method}\nOutcome: ${event.outcome}\nSource IP: ${event.sourceIp}`;
        await sendNotification(getNotificationConfig(), { title: authenticationTitle(event), message, priority: authenticationPriority(event) });
    } finally {
        authenticationDeliveries--;
        if (!authenticationDeliveries) {
            authenticationBusyReported = false;
        }
    }
}

const authenticationFailures = createDigest({
    cooldownMs,
    deliver: deliverAuthentication,
    onSummaryFailed: event => logger.warn('Authentication notification summary delivery failed', { method: event.method }),
});

function notifyAuthenticationEvent(event) {
    if (!enabled('authentication')) {
        return;
    }
    return event.outcome === 'failure' ? authenticationFailures.add(event.method, event) : deliverAuthentication(event);
}

// --- External configuration changes ---------------------------------------

const REPRESENTATIONS = { file: 'Caddyfile', live: 'live configuration' };

async function deliverConfigurationChange(change, additional = 0) {
    if (!enabled('configurationChange')) {
        return;
    }
    const changed = change.representations.map(key => REPRESENTATIONS[key]).join(' and ');
    const lines = [
        `Instance: ${change.instanceName}`,
        `Changed: ${changed}`,
        `Detected: ${change.detectedAt}`,
        'Source: unknown, outside a tracked caddy/ui operation',
        ...(change.historyEntry ? [`History entry: ${change.historyEntry}`] : []),
    ];
    const message = additional
        ? `${additional} additional unexplained configuration changes on ${change.instanceName} during the cooldown.\n${lines.slice(1).join('\n')}`
        : lines.join('\n');
    await sendNotification(getNotificationConfig(), { title: 'Configuration changed outside caddy/ui', message, priority: 'high' });
}

const configurationChanges = createDigest({
    cooldownMs,
    deliver: deliverConfigurationChange,
    onSummaryFailed: (change, err) => logger.warn('Configuration change notification summary delivery failed', { instanceId: change.instanceId, error: err.message }),
});

export function notifyConfigurationChange(change) {
    if (enabled('configurationChange')) {
        return configurationChanges.add(change.instanceId, change);
    }
}

// --- Online/offline transitions -------------------------------------------

// How each monitored kind is announced. `failure` is why a route check failed.
const TRANSITIONS = {
    upstream: {
        offline: { trigger: 'upstreamOffline', alert: label => ({ title: 'Upstream offline', message: `${label} is unreachable`, priority: 'high' }) },
        online: { trigger: 'upstreamOnline', alert: label => ({ title: 'Upstream recovered', message: `${label} is back online`, priority: 'default' }) },
    },
    route: {
        offline: { trigger: 'routeOffline', alert: (label, failure) => ({ title: 'Route down', message: `${label} is down: ${failure}`, priority: 'high' }) },
        online: { trigger: 'routeOnline', alert: label => ({ title: 'Route recovered', message: `${label} is back up`, priority: 'default' }) },
    },
};

const RETRY_DELAYS_MS = [30_000, 60_000];

// One record per monitored target: its last known state, whether the user was
// told it went offline (recovery is only announced then), and the delivery in
// flight. Replacing `pending` invalidates the attempts of the one it replaces.
const targets = new Map();
const targetKey = (kind, instanceId, target) => JSON.stringify([kind, instanceId, target]);
const transitionAlert = (type, { kind, target }) => `${type} ${kind} ${target}`;

function cancelPending(record) {
    if (record.pending) {
        clearTimeout(record.pending.timer);
    }
    record.pending = null;
}

function cancelPendingWhere(predicate) {
    for (const record of targets.values()) {
        if (record.pending && predicate(record)) {
            cancelPending(record);
        }
    }
}

function forgetTarget(key) {
    const record = targets.get(key);
    if (!record) {
        return;
    }
    cancelPending(record);
    targets.delete(key);
    for (const type of ['offline', 'online']) {
        debounced.get(record.instanceId)?.delete(transitionAlert(type, record));
    }
}

async function attempt(record, pending) {
    if (record.pending !== pending) {
        return;
    }
    const { type, alert, attemptNumber } = pending;
    if (!enabled(TRANSITIONS[record.kind][type].trigger) || record.online !== (type === 'online')
        || !getInstances().some(inst => inst.id === record.instanceId)) {
        cancelPending(record);
        return;
    }
    pending.timer = null;
    try {
        await sendNotification(getNotificationConfig(), alert);
        if (record.pending !== pending) {
            return;
        }
        record.pending = null;
        record.deliveredOffline = type === 'offline';
        debounce(record.instanceId, transitionAlert(type, record));
    } catch (err) {
        if (record.pending !== pending) {
            return;
        }
        const delay = RETRY_DELAYS_MS[attemptNumber - 1];
        if (delay === undefined) {
            record.pending = null;
            logger.error('Notification delivery failed after max retries', { kind: record.kind, target: record.target, type, attempts: attemptNumber, error: err.message });
            return;
        }
        logger.warn('Notification delivery failed, scheduling retry', { kind: record.kind, target: record.target, type, attempt: attemptNumber, nextIn: `${delay / 1000}s`, error: err.message });
        pending.attemptNumber++;
        pending.timer = setTimeout(() => void attempt(record, pending), delay);
        pending.timer.unref?.();
    }
}

// Fed by the monitor after each round rather than by probes of our own. State
// is tracked while notifications are off too, so turning them on compares
// against the current state, not a stale one. Targets missing from a round
// (removed from the config, excluded) are forgotten, so a later return is a
// fresh baseline rather than a transition.
export async function notifyCheckResults(kind, inst, results) {
    const seen = new Set();
    const changed = [];
    for (const result of results) {
        const key = targetKey(kind, inst.id, result.target);
        seen.add(key);
        const record = targets.get(key) || { kind, instanceId: inst.id, target: result.target, online: undefined, deliveredOffline: false, pending: null };
        targets.set(key, record);
        if (record.online !== undefined && record.online !== result.online) {
            cancelPending(record);
            changed.push({ record, result });
        }
        record.online = result.online;
    }
    for (const [key, record] of targets) {
        if (record.kind === kind && record.instanceId === inst.id && !seen.has(key)) {
            forgetTarget(key);
        }
    }

    for (const { record, result } of changed) {
        const type = result.online ? 'online' : 'offline';
        const transition = TRANSITIONS[kind][type];
        if (!enabled(transition.trigger) || isDebounced(inst.id, transitionAlert(type, record))) {
            continue;
        }
        if (type === 'online' && !record.deliveredOffline) {
            continue;
        }
        const pending = { type, attemptNumber: 1, timer: null, alert: transition.alert(instanceLabel(inst) + result.label, result.failure) };
        record.pending = pending;
        await attempt(record, pending);
    }
}

// --- Reminders: certificates, releases, API tokens -------------------------

// Instances whose certificate storage couldn't be read on the last check, so
// the failure is logged once per outage rather than on every check.
const certReadFailures = new Set();

async function remindExpiringCertificates(inst) {
    let certificates;
    try {
        certificates = await listCertificates(inst, { quiet: true });
        if (certReadFailures.delete(inst.id)) {
            logger.info('Certificate expiry checks resumed', { instance: inst.name });
        }
    } catch (err) {
        if (!certReadFailures.has(inst.id)) {
            certReadFailures.add(inst.id);
            logger.warn('Certificate expiry checks skipped: certificates could not be read', { instance: inst.name, reason: err.context?.reason || err.message });
        }
        return;
    }
    for (const cert of certificates) {
        if (cert.status !== 'expiring') {
            continue;
        }
        const alert = `expiring ${cert.domain}`;
        if (isDebounced(inst.id, alert)) {
            continue;
        }
        const days = cert.daysRemaining;
        try {
            await sendNotification(getNotificationConfig(), {
                title: 'Certificate expiring',
                message: `${instanceLabel(inst)}${certificateName(cert.domain)} expires in ${days} day${days !== 1 ? 's' : ''}`,
                priority: 'high',
            });
            debounce(inst.id, alert);
        } catch (err) {
            logger.warn('Certificate expiry notification failed', { instance: inst.name, domain: cert.domain, error: err.message });
        }
    }
}

// Each caddy/ui release and each token notifies once per process, rather
// than repeating every debounce window like outage alerts: neither recovers
// the way an upstream can, so repeating would only nag.
const notifiedUpdates = new Set();
const notifiedTokens = new Set();

async function remindUpdate() {
    const notification = getUpdateNotification();
    if (!notification || notifiedUpdates.has(notification.key)) {
        return;
    }
    notifiedUpdates.add(notification.key);
    await sendNotification(getNotificationConfig(), { title: notification.title, message: notification.message, priority: 'default' });
}

// API tokens alert once each when this much of their lifetime is left. Tokens
// issued for no longer than this are short-lived on purpose and skipped, or
// they'd alert as soon as they were created.
const TOKEN_EXPIRY_WINDOW_MS = 7 * DAY_MS;

async function remindExpiringApiTokens() {
    const now = Date.now();
    for (const token of listApiTokens()) {
        const expiresAt = Date.parse(token.expiresAt);
        const remaining = expiresAt - now;
        if (remaining <= 0 || remaining > TOKEN_EXPIRY_WINDOW_MS) {
            continue;
        }
        if (expiresAt - Date.parse(token.createdAt) <= TOKEN_EXPIRY_WINDOW_MS) {
            continue;
        }
        if (notifiedTokens.has(token.id)) {
            continue;
        }
        // Reserved before delivery and released if it fails, so a failed alert is retried next round.
        notifiedTokens.add(token.id);
        try {
            const days = Math.ceil(remaining / DAY_MS);
            await sendNotification(getNotificationConfig(), {
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

const REMINDERS = [
    { trigger: 'certExpiring', category: 'certificates', remind: () => Promise.all(getInstances().map(remindExpiringCertificates)) },
    { trigger: 'updateAvailable', category: 'updates', remind: remindUpdate },
    { trigger: 'apiTokenExpiring', category: 'api-tokens', remind: remindExpiringApiTokens },
];

let reminderRound = null;

// Runs a round of reminders unless one is already in flight, and returns it,
// so a slow provider can't make the interval start a second, duplicate round.
export function runReminders() {
    reminderRound ??= remind().finally(() => { reminderRound = null; });
    return reminderRound;
}

async function remind() {
    forgetExpiredDebounces();
    const due = REMINDERS.filter(reminder => enabled(reminder.trigger));
    const results = await Promise.allSettled(due.map(reminder => reminder.remind()));
    results.forEach((result, i) => {
        if (result.status === 'rejected') {
            logger.error('Notification check failed', { category: due[i].category, error: result.reason?.message ?? String(result.reason) });
        }
    });
}

function applyConfig(config) {
    // Configuration changes must not deliver summaries accumulated for an old destination.
    authenticationFailures.clear();
    configurationChanges.clear();
    cancelPendingWhere(record => !config.enabled || !config.triggers[TRANSITIONS[record.kind][record.pending.type].trigger]);
    if (config.enabled && !reminderTimer) {
        logger.info('Notification reminders started');
        reminderTimer = setInterval(runReminders, REMINDER_INTERVAL_MS);
        reminderTimer.unref?.();
        void runReminders();
    } else if (!config.enabled && reminderTimer) {
        clearInterval(reminderTimer);
        reminderTimer = null;
        logger.info('Notification reminders stopped');
    }
}

// Removal must clean up even if this was the last instance being monitored.
export function forgetInstanceNotifications(instanceId) {
    for (const [key, record] of targets) {
        if (record.instanceId === instanceId) {
            forgetTarget(key);
        }
    }
    certReadFailures.delete(instanceId);
    configurationChanges.forget(instanceId);
    debounced.delete(instanceId);
}

// apiTokens lists token metadata (no secrets) for expiry reminders.
export async function initNotifications({ apiTokens } = {}) {
    if (apiTokens) {
        listApiTokens = apiTokens;
    }
    onAuthenticationEvent(notifyAuthenticationEvent);
    onNotificationConfigChange(applyConfig);
    applyConfig(await loadNotificationConfig());
}

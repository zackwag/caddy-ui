import { createHash } from 'node:crypto';
import { caddyGetConfig, hasUnsettledWrites } from './caddy.js';
import { NOT_APPLIED, UNCHANGED, VERIFIED } from './configVerification.js';
import { readContainerFile } from './containerFs.js';
import { getInstances } from './instances.js';
import { runExclusive } from './instanceQueue.js';
import logger from './logger.js';

// Detects configuration changes made outside caddy-ui by fingerprinting each
// instance's Caddyfile and running config, independently of browser activity.
//
// Each instance keeps two states apart:
// - expected: what caddy-ui last established, from a verified local change or
//   the startup baseline
// - observed: what the latest check found
// An observed state that differs from the expected one is reported once as an
// unexplained change and never becomes expected by being observed. Only a
// verified local change, or one a later check confirms (see pending), updates
// what's expected.
//
// Checks run in the instance's change queue, so they never see a local change
// half-applied, and skip a round while a caddy-ui write to that instance is
// still unsettled after a timeout.
export const DRIFT_CHECK_INTERVAL_MS = 60_000;
// Unexplained changes retained per instance for later diff history.
export const DRIFT_HISTORY_LIMIT = 20;

const states = new Map();
let timer = null;

const fingerprintText = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;
// Enough of a fingerprint to tell states apart in logs.
const shortFingerprint = fingerprint => fingerprint?.replace(/^(sha256|etag):/, '').replace(/\W/g, '').slice(-12) ?? null;

function stateFor(instanceId) {
    let state = states.get(instanceId);
    if (!state) {
        state = { expected: null, pending: null, reported: null, failing: false, changes: [] };
        states.set(instanceId, state);
    }
    return state;
}

async function observe({ adminUrl, configPath, containerName }) {
    const [text, live] = await Promise.all([readContainerFile(containerName, configPath), caddyGetConfig(adminUrl)]);
    return { file: fingerprintText(text), live: live.fingerprint };
}

function changedRepresentations(previous, current) {
    return ['file', 'live'].filter(representation => previous[representation] !== current[representation]);
}

// Called inside the change queue after a local change was read back.
// `content` is the Caddyfile the change left on disk, or null when it didn't
// touch the file. A fully verified change becomes the expected state now.
// Anything less (a mismatch, an unavailable readback or a timeout) is pending:
// the next check accepts it only if the file is what the change wrote and
// `verifyLive` confirms the running config, so an unrelated concurrent change
// isn't explained away.
export async function recordLocalChange(instance, { content, verification, verifyLive }) {
    const state = stateFor(instance.id);
    const file = content === null ? state.expected?.file ?? null : fingerprintText(content);
    const verified = [VERIFIED, UNCHANGED].includes(verification.file) && [VERIFIED, NOT_APPLIED].includes(verification.live);
    if (verified) {
        try {
            state.expected = await observe(instance);
            state.pending = null;
            state.reported = null;
            return;
        } catch (error) {
            logger.warn('Could not fingerprint the configuration after a local change', { instanceId: instance.id, error: error.name });
        }
    }
    state.pending = { file, verifyLive };
}

async function explainedByPendingChange(state, observed) {
    const { pending } = state;
    if (!pending || (pending.file !== null && pending.file !== observed.file)) {
        return false;
    }
    try {
        return await pending.verifyLive() === VERIFIED;
    } catch {
        return false;
    }
}

export async function checkInstance(instance) {
    const state = stateFor(instance.id);
    const context = { instanceId: instance.id, instance: instance.name };
    if (hasUnsettledWrites(instance.adminUrl)) {
        logger.debug('Configuration drift check deferred: a caddy-ui write is unsettled', context);
        return;
    }
    let observed;
    try {
        observed = await observe(instance);
    } catch (error) {
        if (!state.failing) {
            logger.warn('Configuration drift check unavailable', { ...context, error: [error.name, error.code, error.status].filter(Boolean).join(' ') });
        }
        state.failing = true;
        return;
    }
    if (state.failing) {
        logger.info('Configuration drift check available again', context);
        state.failing = false;
    }
    if (!state.expected) {
        state.expected = observed;
        logger.info('Configuration baseline established', { ...context, file: shortFingerprint(observed.file), live: shortFingerprint(observed.live) });
        return;
    }
    if (!changedRepresentations(state.expected, observed).length) {
        state.pending = null;
        state.reported = null;
        return;
    }
    if (await explainedByPendingChange(state, observed)) {
        state.expected = observed;
        state.pending = null;
        state.reported = null;
        logger.info('Local configuration change confirmed', context);
        return;
    }
    // A pending change that didn't explain this state can't explain a later one.
    state.pending = null;
    const key = `${observed.file} ${observed.live}`;
    if (state.reported === key) {
        return;
    }
    state.reported = key;
    const representations = changedRepresentations(state.expected, observed);
    state.changes.push({ detectedAt: new Date().toISOString(), representations, previous: { ...state.expected }, current: observed });
    state.changes.splice(0, Math.max(0, state.changes.length - DRIFT_HISTORY_LIMIT));
    logger.warn('Configuration changed outside caddy-ui', { ...context, representations,
        previous: { file: shortFingerprint(state.expected.file), live: shortFingerprint(state.expected.live) },
        current: { file: shortFingerprint(observed.file), live: shortFingerprint(observed.live) } });
}

export async function checkAllInstances() {
    const instances = getInstances();
    const ids = new Set(instances.map(instance => instance.id));
    for (const id of states.keys()) {
        if (!ids.has(id)) {
            states.delete(id);
        }
    }
    await Promise.all(instances.map(instance => runExclusive(instance.id, () => checkInstance(instance)).catch(error => {
        logger.warn('Configuration drift check failed', { instanceId: instance.id, error: error.name });
    })));
}

// A copy of an instance's drift state, for diagnostics and later history.
export function getConfigDriftState(instanceId) {
    const state = states.get(instanceId);
    if (!state) {
        return null;
    }
    return { expected: state.expected, pending: Boolean(state.pending), failing: state.failing, changes: state.changes.map(change => ({ ...change })) };
}

export function startConfigDriftMonitor() {
    if (timer) {
        return;
    }
    checkAllInstances();
    timer = setInterval(checkAllInstances, DRIFT_CHECK_INTERVAL_MS).unref();
}

// For tests.
export function resetConfigDrift() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    states.clear();
}

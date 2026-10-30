import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
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
        state = { expected: null, liveConfig: undefined, pending: null, reported: null, failing: false, changes: [] };
        states.set(instanceId, state);
    }
    return state;
}

async function observe({ adminUrl, configPath, containerName }) {
    const [text, live] = await Promise.all([readContainerFile(containerName, configPath), caddyGetConfig(adminUrl)]);
    return { file: fingerprintText(text), live: live.fingerprint, config: live.config };
}

const fingerprints = ({ file, live }) => ({ file, live });

async function acceptLiveExpectation(state, expectLive) {
    const config = await expectLive?.(structuredClone(state.liveConfig));
    if (config === undefined) return false;
    state.liveConfig = structuredClone(config);
    // Caddy's ETag isn't computable from an intended JSON result. Keep a hash
    // until a read matches that result, then use the matching read's ETag.
    state.expected.live = fingerprintText(JSON.stringify(config));
    return true;
}

function matchLiveFingerprint(state, observed) {
    if (state.expected.live !== observed.live && isDeepStrictEqual(state.liveConfig, observed.config)) {
        state.expected.live = observed.live;
    }
}

function changedRepresentations(previous, current) {
    return ['file', 'live'].filter(representation => previous[representation] !== current[representation]);
}

// Called inside the change queue after readback. expectLive returns the complete
// intended config: the adapter's result for a load, or the previous expected
// config with just the submitted route mutation applied. Its scope is independent
// of whether the operation wrote a Caddyfile. Neither path adopts a fresh read.
export async function recordLocalChange(instance, { content, verification, verifyLive, expectLive }) {
    const state = stateFor(instance.id);
    // Until the first successful observation there is no baseline to compare.
    // The monitor will establish it using the documented startup behavior.
    if (!state.expected) return;
    const file = content === null ? null : fingerprintText(content);
    const fileVerified = [VERIFIED, UNCHANGED].includes(verification.file);
    if (file !== null && fileVerified) state.expected.file = file;
    let liveAccepted = verification.live === NOT_APPLIED;
    if (verification.live === VERIFIED) {
        try {
            liveAccepted = await acceptLiveExpectation(state, expectLive);
        } catch (error) {
            logger.warn('Could not establish the expected configuration after a local change', { instanceId: instance.id, error: error.name });
        }
    }
    state.pending = (!fileVerified && file !== null) || !liveAccepted
        ? { file: !fileVerified ? file : null, live: !liveAccepted, verifyLive, expectLive } : null;
}

async function confirmPendingChange(state, observed) {
    const { pending } = state;
    if (!pending) return false;
    let confirmed = false;
    if (pending.file !== null && pending.file === observed.file) {
        state.expected.file = pending.file;
        confirmed = true;
    }
    try {
        if (pending.live && await pending.verifyLive() === VERIFIED) {
            confirmed = await acceptLiveExpectation(state, pending.expectLive) || confirmed;
        }
    } catch {
        // Unavailable/mismatched readback can't justify accepting live state.
    }
    state.pending = null;
    return confirmed;
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
        state.expected = fingerprints(observed);
        state.liveConfig = structuredClone(observed.config);
        state.pending = null;
        logger.info('Configuration baseline established', { ...context, file: shortFingerprint(observed.file), live: shortFingerprint(observed.live) });
        return;
    }
    if (await confirmPendingChange(state, observed)) {
        logger.info('Local configuration change confirmed', context);
    }
    matchLiveFingerprint(state, observed);
    if (!changedRepresentations(state.expected, observed).length) {
        state.reported = null;
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
    state.changes.push({ detectedAt: new Date().toISOString(), representations, previous: { ...state.expected }, current: fingerprints(observed) });
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
    return { expected: state.expected && { ...state.expected }, pending: Boolean(state.pending), failing: state.failing, changes: state.changes.map(change => ({ ...change })) };
}

export function startConfigDriftMonitor() {
    if (timer) {
        return;
    }
    checkAllInstances().catch(() => {});
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

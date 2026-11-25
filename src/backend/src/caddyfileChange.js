import { AppError, asAppError } from './AppError.js';
import { CaddyTimeoutError } from './caddy.js';
import { adaptedConfig, reloadCaddy } from './caddyfileRuntime.js';
import { checkInstance, fingerprintText, recordLocalChange } from './configDrift.js';
import { NOT_APPLIED, UNCHANGED, verificationWarning, verifyAfterTimeout, verifyFile, verifyLiveConfig } from './configVerification.js';
import { configurationHistory } from './configurationHistory.js';
import { describeReadError, readContainerFile, removeContainerPath, writeContainerFile } from './containerFs.js';
import { runExclusive } from './instanceQueue.js';
import logger from './logger.js';

// Reads the file a change would replace: null when there is no file yet, so a
// rollback removes it. Any other read failure stops the change, since the
// previous content couldn't be restored.
async function readPreviousCaddyfile(configPath, containerName) {
    try {
        return await readContainerFile(containerName, configPath);
    } catch (err) {
        if (describeReadError(err) === 'not found') return null;
        throw new AppError('CADDYFILE_READ_FAILED', { cause: err, context: { configPath } });
    }
}

// The editor's validator for the Caddyfile text it was served. Caddy's ETag
// can't stand in: it describes the running config, and /load ignores it.
export function caddyfileETag(text) {
    return `"${fingerprintText(text)}"`;
}

// Whether the file a change would replace is one the client said it was based
// on. `*` accepts any existing file; no file matches nothing else.
function matchesCaddyfile(tags, previous) {
    if (previous === null) {
        return false;
    }
    return tags.includes('*') || tags.includes(caddyfileETag(previous));
}

async function restoreCaddyfile(previous, { configPath, containerName }) {
    if (previous === null) await removeContainerPath(containerName, configPath);
    else await writeContainerFile(containerName, configPath, previous);
}

// Applies a change. Rejects when Caddy rejected it; a timeout resolves as
// uncertain, since the change may still complete.
async function attempt(apply) {
    try {
        await apply();
        return { applied: true };
    } catch (error) {
        if (!(error instanceof CaddyTimeoutError)) throw error;
        return { applied: false, uncertain: true, error };
    }
}

// How a change reaches the running config:
// - apply: makes the change
// - verify: reads back the part of the live config it changed
// - expectLive: projects the change onto the last expected config, for drift
//   attribution. A scoped verify alone cannot approve the whole live config.
// This one applies a Caddyfile by reloading Caddy, and checks the whole config
// against Caddy's own adaptation of it.
function reloadChange(instance, content) {
    let via, expected;
    return {
        apply: async () => { via = await reloadCaddy(content, instance); },
        verify: () => verifyLiveConfig(instance, async () => {
            expected = await adaptedConfig(content, instance, via);
            return expected;
        }),
        expectLive: () => expected,
    };
}

// Reads a change's result back and records it as the expected state. `content`
// is the Caddyfile's text, or null when the change has no counterpart in it.
async function readBack(instance, { applied, uncertain }, { verify, expectLive }, { content, file }) {
    const live = applied ? await verify() : uncertain ? await verifyAfterTimeout(verify) : NOT_APPLIED;
    const verification = { file, live };
    await recordLocalChange(instance, { content, verification, verifyLive: verify, expectLive });
    return verification;
}

// A change to the running config that leaves the Caddyfile as it is.
async function applyLiveChange(instance, live, content = null) {
    const result = await attempt(live.apply);
    const verification = await readBack(instance, result, live, { content, file: UNCHANGED });
    return { ...result, verification, ...verificationWarning(verification) };
}

// The one path for changing an instance's Caddyfile, so disk and the running
// config stay in agreement: preserve the previous file, write, apply and commit
// the saved version. Restore the previous file if writing or applying fails.
// Caddy is reloaded from the new content, unless `live` makes the matching change
// through the admin API instead (see reloadChange for its shape). Throws:
// - CADDYFILE_READ_FAILED / CADDYFILE_WRITE_FAILED: nothing changed
// - CADDYFILE_CHANGED: `ifMatch` (ETags from an If-Match header) doesn't name
//   the file the change would replace, so nothing was written or attributed to
//   this operation (independent external discovery may already be preserved)
// - CADDYFILE_CHANGE_REJECTED: applying failed and the previous file was restored
//   (an AppError thrown by `live.apply` keeps its own code)
// - CADDYFILE_ROLLBACK_FAILED: the previous file couldn't be restored, so the
//   file on disk is not what Caddy is running
// With rollback: false (the editor's force save), a failed apply leaves the
// new file in place and resolves to { applied: false, error }. An apply that
// timed out may still complete in Caddy, so it never restores the previous
// file or retries: it keeps the new file, resolves with live: 'uncertain'
// unless a readback already shows it applied, and records the history
// version with an unknown outcome.
// Function changes run inside the queue against the latest file. Post-apply
// history failures return warning fields rather than rejecting an applied edit.
// The result's `verification` reads back the file and the live config (see
// configVerification.js). Verification never rejects a saved change: it adds warning fields.
export function saveCaddyfileChange(instance, content, options = {}) {
    return queueCaddyfileChange(instance, ({ save }) => save(content, options));
}

// For changes that depend on state read inside the queue. The operation gets
// `save`, which takes what saveCaddyfileChange does, and `applyLive`, for a
// `live` change with no Caddyfile counterpart.
export function queueCaddyfileChange(instance, operation) {
    return runExclusive(instance.id, async () => {
        // Preserve changes discovered since the last poll before a local write
        // can replace either representation. No nested queue acquisition.
        try { await checkInstance(instance, { report: false }); }
        catch (cause) { throw new AppError('CADDYFILE_HISTORY_WRITE_FAILED', { cause, context: { instanceId: instance.id } }); }
        return operation({
            save: (change, options) => saveChange(instance, change, options),
            applyLive: live => applyLiveChange(instance, live),
        });
    });
}

// Reloads Caddy from the Caddyfile on disk. Queued with saves, so its readback
// can't observe another change mid-write.
export function reloadCaddyfile(instance) {
    return queueCaddyfileChange(instance, async () => {
        const content = await readContainerFile(instance.containerName, instance.configPath);
        return applyLiveChange(instance, reloadChange(instance, content), content);
    });
}

async function saveChange(instance, change, { live, onApplied, rollback = true, actor = null, action = 'caddyfile.save', ifMatch = null } = {}) {
    const { configPath, containerName, id } = instance;
    const context = { instanceId: id, configPath };
    const previous = await readPreviousCaddyfile(configPath, containerName);
    // Checked against the file read inside the queue, so no other caddy/ui
    // change can land between this check and the write
    if (ifMatch && !matchesCaddyfile(ifMatch, previous)) {
        throw new AppError('CADDYFILE_CHANGED', { context });
    }
    if (typeof change === 'function' && previous === null) throw new AppError('CADDYFILE_READ_FAILED', { context });
    const content = typeof change === 'function' ? await change(previous) : change;
    if (typeof content !== 'string') throw new TypeError('A Caddyfile change must produce text');
    try { await configurationHistory.preserve(id, previous); }
    catch (cause) { throw new AppError('CADDYFILE_HISTORY_WRITE_FAILED', { cause, context }); }

    const restore = async (stage, cause) => {
        try {
            await restoreCaddyfile(previous, instance);
        } catch (restoreErr) {
            logger.error('Could not restore the previous Caddyfile', { ...context, stage, error: restoreErr.message });
            throw new AppError('CADDYFILE_ROLLBACK_FAILED', { cause, context: { ...context, stage, restoreError: restoreErr.message } });
        }
    };

    try {
        await writeContainerFile(containerName, configPath, content);
    } catch (err) {
        await restore('write', err);
        throw new AppError('CADDYFILE_WRITE_FAILED', { cause: err, context });
    }

    live ??= reloadChange(instance, content);
    let result;
    try {
        result = await attempt(live.apply);
    } catch (err) {
        if (rollback) {
            await restore('apply', err);
            logger.warn('Caddy rejected the change, previous Caddyfile restored', { ...context, error: err.message });
            // A live change can name a more specific rejection, such as CONFIG_CHANGED
            throw asAppError(err, 'CADDYFILE_CHANGE_REJECTED', context);
        }
        result = { applied: false, error: err };
    }
    if (result.uncertain) {
        logger.warn('Caddy did not confirm the change in time; keeping the new Caddyfile', { ...context, error: result.error.message });
    }
    // State kept beside the file (maintenance) follows the file, which an
    // uncertain apply keeps.
    if ((result.applied || result.uncertain) && onApplied) await onApplied();
    result.verification = await readBack(instance, result, live, { content, file: await verifyFile(instance, content) });
    const warnings = [];
    const outcome = result.applied ? 'applied' : result.uncertain ? 'unknown' : 'saved-unapplied';
    try { await configurationHistory.record(id, content, { actor, action, outcome }); }
    catch (cause) {
        warnings.push({ warning: 'The Caddyfile was saved, but its history version could not be recorded.', warningCode: 'CADDYFILE_HISTORY_COMMIT_FAILED' });
        logger.warn('Could not record saved Caddyfile history', { ...context, applied: result.applied,
            code: 'CADDYFILE_HISTORY_COMMIT_FAILED', error: cause.message });
    }
    const verificationIssue = verificationWarning(result.verification);
    if (verificationIssue) {
        // A mismatch or an uncertain apply outranks a history failure: the
        // running config may not be what the user saved.
        if (verificationIssue.warningCode !== 'CONFIG_VERIFICATION_UNAVAILABLE') {
            warnings.unshift(verificationIssue);
        } else {
            warnings.push(verificationIssue);
        }
    }
    if (warnings.length) {
        result.warning = warnings.map(entry => entry.warning).join(' ');
        result.warningCode = warnings[0].warningCode;
    }
    return result;
}

// Response fields for a saved change: any warning and the verification result.
export function changeResultFields(result) {
    return {
        ...(result?.warning ? { warning: result.warning, warningCode: result.warningCode } : {}),
        ...(result?.verification ? { verification: result.verification } : {}),
    };
}

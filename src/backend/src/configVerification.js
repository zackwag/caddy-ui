import { isDeepStrictEqual } from 'node:util';
import { caddyReadJson } from './caddy.js';
import { readContainerFile } from './containerFs.js';
import logger from './logger.js';

// Readback after a configuration change. Each representation is checked
// against what the change should have produced:
// - verified: the readback matches
// - mismatch: the readback differs, e.g. a concurrent external change
// - unavailable: the readback couldn't be made or interpreted
// - not-applied: the change deliberately wasn't applied (force save)
// - unchanged: the operation didn't touch this representation
// - uncertain: applying timed out and the readback didn't show it applied yet;
//   Caddy may still apply or reject it
// A failed check is reported, never retried or repaired: the difference may be
// someone else's change.
export const VERIFIED = 'verified';
export const MISMATCH = 'mismatch';
export const UNAVAILABLE = 'unavailable';
export const NOT_APPLIED = 'not-applied';
export const UNCHANGED = 'unchanged';
export const UNCERTAIN = 'uncertain';

// Names a failure without its message, which can quote configuration.
function describeError(error) {
    return [error?.name, error?.code, error?.status].filter(value => value !== undefined && value !== null).join(' ') || 'Error';
}

// The JSON path of the first difference, for logs. Keys and indexes only,
// never values.
export function firstDifference(actual, expected, path = '') {
    if (isDeepStrictEqual(actual, expected)) {
        return null;
    }
    const container = value => value !== null && typeof value === 'object';
    if (!container(actual) || !container(expected) || Array.isArray(actual) !== Array.isArray(expected)) {
        return path || '(root)';
    }
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    for (const key of keys) {
        const child = Array.isArray(actual) ? `${path}[${key}]` : `${path}${path ? '.' : ''}${key}`;
        if (!isDeepStrictEqual(actual[key], expected[key])) {
            return firstDifference(actual[key], expected[key], child);
        }
    }
    return path || '(root)';
}

async function check(representation, context, read) {
    try {
        const { actual, expected } = await read();
        if (isDeepStrictEqual(actual, expected)) {
            return VERIFIED;
        }
        logger.warn('Configuration readback differs from the change', { ...context, representation,
            difference: typeof expected === 'string' ? null : firstDifference(actual, expected) });
        return MISMATCH;
    } catch (error) {
        logger.warn('Configuration readback unavailable', { ...context, representation, error: describeError(error) });
        return UNAVAILABLE;
    }
}

export function verifyFile({ id, configPath, containerName }, expected) {
    return check('file', { instanceId: id }, async () => ({
        actual: await readContainerFile(containerName, configPath),
        expected,
    }));
}

// The whole running config against `adapt()`, the JSON Caddy produces from the
// saved Caddyfile. Use the same adapter that applied the change.
export function verifyLiveConfig({ id, adminUrl }, adapt) {
    return check('live', { instanceId: id }, async () => {
        const [actual, expected] = await Promise.all([caddyReadJson('/config/', adminUrl), adapt()]);
        return { actual, expected };
    });
}

// One object addressed by @id, after the admin API created or replaced it.
// Caddy answers 404 for an unknown @id: the object is missing, a mismatch
// rather than an unreadable config.
export function verifyLiveObject({ id, adminUrl }, objectId, expected) {
    return check('live', { instanceId: id, objectId }, async () => {
        try {
            return { actual: await caddyReadJson(`/id/${encodeURIComponent(objectId)}`, adminUrl), expected };
        } catch (error) {
            if (error?.status === 404) {
                return { actual: undefined, expected };
            }
            throw error;
        }
    });
}

function containsId(value, objectId) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    if (value['@id'] === objectId) {
        return true;
    }
    return Object.values(value).some(child => containsId(child, objectId));
}

// An @id the admin API deleted, searched for in the HTTP servers. Caddy serves
// null when there are none, which verifies the removal.
export function verifyLiveObjectRemoved({ id, adminUrl }, objectId) {
    return check('live', { instanceId: id, objectId }, async () => ({
        actual: containsId(await caddyReadJson('/config/apps/http/servers', adminUrl), objectId),
        expected: false,
    }));
}

// The readback after applying timed out: it only settles the question when
// the config already matches. Anything else stays uncertain, since the write
// may still complete.
export async function verifyAfterTimeout(verify) {
    return await verify() === VERIFIED ? VERIFIED : UNCERTAIN;
}

// The most significant warning for a verification result, if any.
export function verificationWarning({ file, live }) {
    if (live === UNCERTAIN) {
        return {
            warning: 'Caddy didn\'t confirm the change in time. It may still apply.',
            warningCode: 'CADDY_APPLY_UNCERTAIN',
        };
    }
    if (file === MISMATCH || live === MISMATCH) {
        return {
            warning: 'Reading the configuration back after this change found differences. Another process may have changed it.',
            warningCode: 'CONFIG_VERIFICATION_MISMATCH',
        };
    }
    if (file === UNAVAILABLE || live === UNAVAILABLE) {
        return {
            warning: 'The configuration could not be read back to confirm this change.',
            warningCode: 'CONFIG_VERIFICATION_UNAVAILABLE',
        };
    }
    return null;
}

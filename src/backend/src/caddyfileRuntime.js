import { dirname, join } from 'path';
import { CaddyTimeoutError, caddyAdapt, caddyLoad, markConfigChanged } from './caddy.js';
import { removeContainerPath, writeContainerFile } from './containerFs.js';
import { execInInstance, isContainerUnreachable } from './docker.js';
import logger from './logger.js';

// What caddy-ui asks Caddy to do with a Caddyfile: format, validate, load and
// adapt it. The admin API is tried first, then the instance's caddy binary.

// Formatted content, or the content as given when it can't be formatted.
export async function fmtCaddyfile(content, { containerName }) {
    try {
        const { stdout } = await execInInstance(containerName, 'caddy', ['fmt', '-'], content);
        return stdout || content;
    } catch (err) {
        logger.warn('caddy fmt failed', { error: err.message });
        return content;
    }
}

// The caddy binary couldn't be run at all, as opposed to running and rejecting
// the Caddyfile.
function isBinaryUnavailable(err) {
    if (!err) {
        return false;
    }
    if (err.code === null || err.code === undefined || err.code === 'ENOENT') {
        return true;
    }
    return isContainerUnreachable(err)
        || /docker:? (?:command )?not found|executable file not found|not found in \$path/i.test(`${err.stderr || ''} ${err.message || ''}`);
}

// Adapt through the caddy binary in the Caddy container, writing the buffer to a
// temp file next to the real Caddyfile so relative `import` paths resolve.
//
// Runs as separate array-argument exec calls (no shell) rather than a single
// interpolated `sh -c` script, since configPath -- and therefore tmp -- isn't
// validated against shell metacharacters and previously would have let a
// crafted instance config break out of the script's quoting.
async function adaptViaCaddyBinary(content, configPath, containerName) {
    const tmp = join(dirname(configPath), `.caddy-ui-adapt-${process.pid}-${Date.now()}.tmp`);
    await writeContainerFile(containerName, tmp, content);
    try {
        const { stdout } = await execInInstance(containerName, 'caddy', ['adapt', '--config', tmp, '--adapter', 'caddyfile']);
        return stdout;
    } finally {
        await removeContainerPath(containerName, tmp).catch(() => { });
    }
}

export async function validateCaddyfile(content, { adminUrl, configPath, containerName }) {
    try {
        await caddyAdapt(content, adminUrl);
        return;
    } catch (adminErr) {
        try {
            await adaptViaCaddyBinary(content, configPath, containerName);
            logger.info('Caddyfile validated via caddy binary (admin API adapt failed)');
            return;
        } catch (caddyErr) {
            if (isBinaryUnavailable(caddyErr)) {
                throw adminErr;
            }
            throw caddyErr;
        }
    }
}

// What `caddy adapt` or the admin API said about a Caddyfile that failed
// validation.
export function describeValidationFailure(err) {
    const lines = `${err.stdout || ''}${err.stderr || ''}`.trim().split('\n').filter(Boolean);
    const mentioning = word => lines.filter(line => line.toLowerCase().includes(word));
    const errors = mentioning('error');
    return { errors: errors.length ? errors : [err.message], warnings: mentioning('warn') };
}

// Reloads through the container rather than caddy.js, so it marks the
// change itself for observations.js.
async function reloadViaCaddyBinary(configPath, containerName, adminUrl) {
    try {
        await execInInstance(containerName, 'caddy', ['reload', '--config', configPath, '--adapter', 'caddyfile']);
    } finally {
        markConfigChanged(adminUrl);
    }
}

// Resolves to how the config was applied, 'admin' or 'binary', so verification
// can adapt the same way (see adaptedConfig).
export async function reloadCaddy(content, { adminUrl, configPath, containerName }) {
    try {
        await caddyLoad(content, adminUrl);
        return 'admin';
    } catch (loadErr) {
        // In local mode the bundled binary would resolve {$VAR} placeholders
        // from caddy-ui's environment rather than Caddy's, and it would post to
        // the same admin API that just failed, so there's nothing to fall back to.
        // After a timeout the load may still complete, so reloading again would
        // apply the change twice.
        if (!containerName || loadErr instanceof CaddyTimeoutError) {
            throw loadErr;
        }
        try {
            await reloadViaCaddyBinary(configPath, containerName, adminUrl);
            logger.info('Caddy reloaded via caddy binary (admin /load failed)');
            return 'binary';
        } catch (caddyErr) {
            if (isBinaryUnavailable(caddyErr)) {
                throw loadErr;
            }
            throw caddyErr;
        }
    }
}

// The config Caddy makes of the content, adapted the way it was applied.
export async function adaptedConfig(content, { adminUrl, configPath, containerName }, via) {
    if (via === 'binary') {
        return JSON.parse(await adaptViaCaddyBinary(content, configPath, containerName));
    }
    return caddyAdapt(content, adminUrl);
}

import { AppError } from './AppError.js';
import { caddyfileChildren, extractDirective, extractGlobalBlock } from './caddyfileBlocks.js';
import { setGlobalOption } from './caddyfileGlobals.js';
import { INSTANCE_DEFAULTS } from './instances.js';

// The default logger in a Caddyfile's global options, as settings and back.

function defaultLogger(source) {
    return extractDirective(source, 'log', child => child.args.length === 0
        || (child.args.length === 1 && child.args[0] === 'default'));
}

export function parseLogConfig(content) {
    const defaultConfig = {
        enabled: false,
        path: INSTANCE_DEFAULTS.logPath,
        rollSize: '50mb',
        rollKeep: 5,
        format: 'json',
        level: 'INFO',
    };

    const global = extractGlobalBlock(content);
    if (!global) {
        return defaultConfig;
    }

    const log = defaultLogger(global.inner);
    if (!log) {
        return defaultConfig;
    }

    const children = caddyfileChildren(log.inner);
    const config = { ...defaultConfig, enabled: true };
    const output = children.find(child => child.name === 'output');
    if (output?.args[0] === 'file' && output.args[1]) {
        config.path = output.args[1];
        const rolling = caddyfileChildren(output.block?.inner || '');
        config.rollSize = rolling.find(child => child.name === 'roll_size')?.args[0] ?? config.rollSize;
        const keep = rolling.find(child => child.name === 'roll_keep')?.args[0];
        if (keep !== undefined) {
            config.rollKeep = Number.parseInt(keep, 10);
        }
    }
    config.format = children.find(child => child.name === 'format')?.args[0] ?? config.format;
    config.level = (children.find(child => child.name === 'level')?.args[0] ?? config.level).toUpperCase();

    return config;
}

function quoteLogPath(path) {
    if (!/[\s"`]/.test(path) && !path.startsWith('#')) {
        return path;
    }
    if (!path.includes('`')) {
        return '`' + path + '`';
    }
    if (path.endsWith('\\')) {
        throw new AppError('VALIDATION_FAILED', { context: { field: 'path' } });
    }
    return '"' + path.replaceAll('"', '\\"') + '"';
}

export function validateLogConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config) || typeof config.enabled !== 'boolean') {
        throw new AppError('VALIDATION_FAILED', { context: { field: 'enabled' } });
    }
    // Disabling emits no option values; only enabled settings need serialization.
    if (!config.enabled) {
        return;
    }
    const valid = {
        // eslint-disable-next-line no-control-regex -- Paths must not contain control characters or Caddyfile line breaks.
        path: typeof config.path === 'string' && config.path.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(config.path),
        rollSize: typeof config.rollSize === 'string' && /^\d+(?:\.\d+)?(?:[kmgtpe]i?b?|b)?$/i.test(config.rollSize),
        rollKeep: Number.isSafeInteger(config.rollKeep) && config.rollKeep >= 0,
        format: ['json', 'console'].includes(config.format),
        level: ['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(config.level),
    };
    const field = Object.keys(valid).find(field => !valid[field]);
    if (field) {
        throw new AppError('VALIDATION_FAILED', { context: { field } });
    }
}

function buildLogBlock(config, { indent, unit, eol, inline }) {
    return [
        [0, 'log {'], [1, `output file ${quoteLogPath(config.path)} {`],
        [2, `roll_size ${config.rollSize}`], [2, `roll_keep ${config.rollKeep}`],
        [1, '}'], [1, `format ${config.format}`], [1, `level ${config.level}`], [0, '}'],
    ].map(([depth, line], index) => (inline && index === 0 ? '' : indent) + unit.repeat(depth) + line).join(eol);
}

export function updateLogConfig(content, config) {
    return setGlobalOption(content, defaultLogger, config.enabled ? style => buildLogBlock(config, style) : null);
}

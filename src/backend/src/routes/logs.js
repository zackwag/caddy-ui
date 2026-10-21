import { Router } from 'express';
import { readContainerFile } from '../containerFs.js';
import { execInInstance, spawnInInstance } from '../docker.js';
import logger, { getRecentLogEntries, subscribeToLogs } from '../logger.js';
import { AppError, asAppError, errorChain, publicError } from '../AppError.js';
import { logReadError } from '../logReadError.js';
import { errorDefinition } from '../errorRegistry.js';
import { sendAppError } from '../errorReporting.js';
import { historyWarning, saveCaddyfileChange, validateCaddyfile } from './caddyfile.js';
import { getAuthentication } from '../middleware/auth.js';
import { caddyfileChildren, extractDirective, extractGlobalBlock } from '../caddyfileBlocks.js';
const router = Router();
const appLogsRouter = Router();
const TAIL_LINES = 200;

// ── Log config parsing ────────────────────────────────────────────────────────

function defaultLogger(source) {
    return extractDirective(source, 'log', child => child.args.length === 0
        || (child.args.length === 1 && child.args[0] === 'default'));
}

function parseLogConfig(content) {
    const defaultConfig = {
        enabled: false,
        path: '/var/log/caddy/access.log',
        rollSize: '50mb',
        rollKeep: 5,
        format: 'json',
        level: 'INFO',
    };

    const global = extractGlobalBlock(content);
    if (!global) return defaultConfig;

    const log = defaultLogger(global.inner);
    if (!log) return defaultConfig;

    const children = caddyfileChildren(log.inner);
    const config = { ...defaultConfig, enabled: true };
    const output = children.find(child => child.name === 'output');
    if (output?.args[0] === 'file' && output.args[1]) {
        config.path = output.args[1];
        const rolling = caddyfileChildren(output.block?.inner || '');
        config.rollSize = rolling.find(child => child.name === 'roll_size')?.args[0] ?? config.rollSize;
        const keep = rolling.find(child => child.name === 'roll_keep')?.args[0];
        if (keep !== undefined) config.rollKeep = Number.parseInt(keep, 10);
    }
    config.format = children.find(child => child.name === 'format')?.args[0] ?? config.format;
    config.level = (children.find(child => child.name === 'level')?.args[0] ?? config.level).toUpperCase();

    return config;
}

function quoteLogPath(path) {
    if (!/[\s"`]/.test(path) && !path.startsWith('#')) return path;
    if (!path.includes('`')) return '`' + path + '`';
    if (path.endsWith('\\')) throw new SyntaxError('Cannot quote the log path');
    return '"' + path.replaceAll('"', '\\"') + '"';
}

function validateLogConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config) || typeof config.enabled !== 'boolean') {
        throw new AppError('VALIDATION_FAILED', { context: { field: 'enabled' } });
    }
    // Disabling emits no option values; only enabled settings need serialization.
    if (!config.enabled) return;
    const valid = {
        // eslint-disable-next-line no-control-regex -- Paths must not contain control characters or Caddyfile line breaks.
        path: typeof config.path === 'string' && config.path.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(config.path),
        rollSize: typeof config.rollSize === 'string' && /^\d+(?:\.\d+)?(?:[kmgtpe]i?b?|b)?$/i.test(config.rollSize),
        rollKeep: Number.isSafeInteger(config.rollKeep) && config.rollKeep >= 0,
        format: ['json', 'console'].includes(config.format),
        level: ['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(config.level),
    };
    const field = Object.keys(valid).find(field => !valid[field]);
    if (field) throw new AppError('VALIDATION_FAILED', { context: { field } });
}

function lineIndent(content, offset) {
    const line = content.lastIndexOf('\n', offset - 1) + 1;
    const prefix = content.slice(line, offset);
    return /^[ \t]*$/.test(prefix) ? prefix : null;
}

function loggingStyle(content, global, log) {
    const base = global ? global.start + 1 : 0;
    const logIndent = log ? lineIndent(content, base + log.headerStart) : null;
    const globalIndent = global ? lineIndent(content, global.start) || '' : '';
    const globalChildren = global ? caddyfileChildren(global.inner) : [];
    const siblingIndent = globalChildren.map(child => lineIndent(content, base + child.start)).find(indent => indent !== null);
    const blocks = [];
    if (log?.block) blocks.push({ block: { ...log.block, start: base + log.block.start }, header: base + log.headerStart });
    if (global) blocks.push({ block: global, header: global.start });
    // When adding the first global block, use the indentation of an existing
    // site/snippet. Literal/comment/heredoc lines are not indentation evidence.
    blocks.push(...caddyfileChildren(content).filter(child => child.block).map(child => ({ block: child.block, header: child.start })));
    let unit;
    for (const { block, header } of blocks) {
        const parent = lineIndent(content, header) || '';
        const indent = caddyfileChildren(block.inner).map(child => lineIndent(content, block.start + 1 + child.start))
            .find(indent => indent !== null && indent.startsWith(parent));
        if (indent !== undefined) { unit = indent.slice(parent.length); break; }
    }
    unit ??= '\t';
    const newline = content.indexOf('\n', log?.block ? base + log.block.start : global?.start ?? 0);
    const eol = newline > 0 && content[newline - 1] === '\r' ? '\r\n' : '\n';
    return { indent: logIndent ?? siblingIndent ?? globalIndent + unit, unit, eol, inline: Boolean(log && logIndent === null) };
}

function buildLogBlock(config, { indent = '\t', unit = '\t', eol = '\n', inline = false } = {}) {
    if (!config.enabled) return null;
    return [
        [0, 'log {'], [1, `output file ${quoteLogPath(config.path)} {`],
        [2, `roll_size ${config.rollSize}`], [2, `roll_keep ${config.rollKeep}`],
        [1, '}'], [1, `format ${config.format}`], [1, `level ${config.level}`], [0, '}'],
    ].map(([depth, line], index) => (inline && index === 0 ? '' : indent) + unit.repeat(depth) + line).join(eol);
}

function updateGlobalBlock(content, logConfig) {
    const global = extractGlobalBlock(content);
    const log = global ? defaultLogger(global.inner) : null;
    const style = logConfig.enabled ? loggingStyle(content, global, log) : null;
    const logBlock = logConfig.enabled ? buildLogBlock(logConfig, style) : null;

    if (!global) {
        if (!logBlock) return content;
        const bom = content.startsWith('\ufeff') ? 1 : 0;
        return content.slice(0, bom) + `{${style.eol}${logBlock}${style.eol}}${style.eol}${style.eol}` + content.slice(bom);
    }

    if (log) {
        const start = global.start + 1 + log.start;
        let end = global.start + 1 + log.end;
        // A removed logger that owned its whole line takes the line break with
        // it, so repeated disable/enable cycles don't accumulate blank lines.
        const lineBreak = content.slice(end).match(/^[ \t]*\r?\n/);
        if (!logBlock && lineBreak && (start === 0 || content[start - 1] === '\n')) {
            end += lineBreak[0].length;
        }
        return content.slice(0, start) + (logBlock || '') + content.slice(end);
    }
    if (!logBlock) return content;

    const line = content.lastIndexOf('\n', global.close - 1) + 1;
    const start = /^\s*$/.test(content.slice(line, global.close)) ? line : global.close;
    const before = content.slice(0, start);
    const separator = before.endsWith('\n') ? '' : style.eol;
    return before + separator + logBlock + style.eol + content.slice(start);
}

// ── Routes ────────────────────────────────────────────────────────────────────

appLogsRouter.get('/', (req, res) => {
    res.json({ entries: getRecentLogEntries(TAIL_LINES) });
});

appLogsRouter.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsubscribe = subscribeToLogs((entry) => {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ entry })}\n\n`);
        }
    });

    // App logs can be quiet for minutes; keep the stream under nginx's 60s proxy_read_timeout.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
    });
});


router.get('/config', async (req, res) => {
    const context = { instanceId: req.instance.id, configPath: req.instance.configPath };
    try {
        const content = await readContainerFile(req.instance.containerName, req.instance.configPath);
        try { res.json(parseLogConfig(content)); }
        catch (cause) { throw new AppError('LOG_CONFIG_PARSE_FAILED', { cause, context }); }
    } catch (cause) {
        return sendAppError(res, asAppError(cause, 'CADDYFILE_READ_FAILED', context));
    }
});

router.put('/config', async (req, res) => {
    const config = req.body;
    try {
        validateLogConfig(config);
        logger.info('Log config update requested', { enabled: config.enabled });
        const result = await saveCaddyfileChange(req.instance, async previous => {
            let updated;
            try {
                updated = updateGlobalBlock(previous, config);
                await validateCaddyfile(updated, req.instance);
            }
            catch (cause) { throw new AppError('CADDYFILE_VALIDATION_FAILED', { cause }); }
            return updated;
        }, { actor: getAuthentication().getActor(req), action: 'logs.configure' });
        logger.info('Log config saved and reloaded');
        res.json({ ok: true, message: 'Log config saved and reloaded', ...historyWarning(result) });
    } catch (err) {
        return sendAppError(res, asAppError(err, 'CADDYFILE_WRITE_FAILED', { instanceId: req.instance.id }));
    }
});

router.get('/', async (req, res) => {
    const { logPath, containerName } = req.instance;
    try {
        const { stdout } = await execInInstance(containerName, 'tail', ['-n', String(TAIL_LINES), '--', logPath]);
        const lines = stdout.split('\n').filter(Boolean);
        res.json({ lines, path: logPath });
    } catch (cause) {
        return sendAppError(res, logReadError(cause, req.instance));
    }
});

router.get('/stream', async (req, res) => {
    const { logPath, containerName } = req.instance;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let buffer = '';
    let stderr = '';
    let disconnected = false;
    let reported = false;
    const reportFailure = cause => {
        if (reported || disconnected || res.writableEnded) return;
        reported = true;
        const error = logReadError(cause, req.instance, 'LOG_STREAM_ERROR');
        logger[errorDefinition(error.code).level]('Caddy log stream failed', {
            requestId: req.diagnosticId, code: error.code, causes: errorChain(error),
        });
        res.write(`data: ${JSON.stringify({ ...publicError(error), requestId: req.diagnosticId })}\n\n`);
        res.end();
    };
    let proc;
    try { proc = spawnInInstance(containerName, 'tail', ['-n', '0', '-f', '--', logPath]); }
    catch (cause) { reportFailure(cause); return; }

    proc.stdout.on('data', (chunk) => {
        if (disconnected || res.writableEnded) return;
        buffer += chunk.toString();
        const parts = buffer.split('\n');
        buffer = parts.pop();
        for (const line of parts.filter(Boolean)) {
            res.write(`data: ${JSON.stringify({ line })}\n\n`);
        }
    });

    proc.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
    proc.on('error', reportFailure);
    proc.on('close', (code, signal) => {
        // A truncation warning on stderr is not a failed live stream. Wait for
        // close so a genuine failure includes all stderr, and report it once.
        if (code !== 0) reportFailure(Object.assign(new Error(stderr.trim() || `tail exited (${code ?? signal})`), { stderr, code }));
        if (!res.writableEnded) res.end();
    });
    req.on('close', () => { disconnected = true; proc.kill(); });
});

export default router;
export { appLogsRouter, parseLogConfig, buildLogBlock, updateGlobalBlock };

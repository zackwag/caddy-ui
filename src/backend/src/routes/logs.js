import { Router } from 'express';
import { readContainerFile } from '../containerFs.js';
import { execInInstance, spawnInInstance } from '../docker.js';
import logger, { getRecentLogEntries, subscribeToLogs } from '../logger.js';
import { AppError, asAppError } from '../AppError.js';
import { sendAppError } from '../errorReporting.js';
import { historyWarning, saveCaddyfileChange, validateCaddyfile } from './caddyfile.js';
import { getAuthentication } from '../middleware/auth.js';
import { caddyfileChildren, extractDirectiveBlock, extractGlobalBlock } from '../caddyfileBlocks.js';
const router = Router();
const appLogsRouter = Router();
const TAIL_LINES = 200;

// ── Log config parsing ────────────────────────────────────────────────────────

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

    const log = extractDirectiveBlock(global.inner, 'log');
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

function buildLogBlock(config) {
    if (!config.enabled) return null;

    return `\tlog {
\t\toutput file ${quoteLogPath(config.path)} {
\t\t\troll_size ${config.rollSize}
\t\t\troll_keep ${config.rollKeep}
\t\t}
\t\tformat ${config.format}
\t\tlevel ${config.level}
\t}`;
}

function updateGlobalBlock(content, logConfig) {
    const logBlock = buildLogBlock(logConfig);
    const global = extractGlobalBlock(content);

    if (!global) {
        if (!logBlock) return content;
        return `{\n${logBlock}\n}\n\n${content}`;
    }

    const log = extractDirectiveBlock(global.inner, 'log');
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
    const separator = before.endsWith('\n') ? '' : '\n';
    return before + separator + logBlock + '\n' + content.slice(start);
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
    const content = await readContainerFile(req.instance.containerName, req.instance.configPath);
    const config = parseLogConfig(content);
    res.json(config);
});

router.put('/config', async (req, res) => {
    const config = req.body;
    if (!config || typeof config !== 'object') {
        return res.status(400).json({ error: 'Invalid log config' });
    }

    logger.info('Log config update requested', { enabled: config.enabled });
    try {
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
        const { stdout } = await execInInstance(containerName, 'tail', ['-n', String(TAIL_LINES), logPath]);
        const lines = stdout.split('\n').filter(Boolean);
        res.json({ lines, path: logPath });
    } catch {
        res.json({ lines: [], error: `Log file not found at ${logPath}` });
    }
});

router.get('/stream', async (req, res) => {
    const { logPath, containerName } = req.instance;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const proc = spawnInInstance(containerName, 'tail', ['-n', '0', '-f', logPath]);
    let buffer = '';

    proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const parts = buffer.split('\n');
        buffer = parts.pop();
        for (const line of parts.filter(Boolean)) {
            res.write(`data: ${JSON.stringify({ line })}\n\n`);
        }
    });

    proc.stderr.on('data', (chunk) => {
        const msg = chunk.toString().trim();
        if (msg) {
            const missing = /no such file|not found/i.test(msg);
            const code = missing ? 'LOG_FILE_MISSING' : 'LOG_STREAM_ERROR';
            if (!missing) logger.error('Caddy log stream failed', { requestId: req.diagnosticId, code, detail: msg });
            res.write(`data: ${JSON.stringify({ error: msg, code, requestId: req.diagnosticId })}\n\n`);
        }
    });

    proc.on('error', () => {
        res.write(`data: ${JSON.stringify({ error: `Log file not found at ${logPath}`, code: 'LOG_FILE_MISSING', requestId: req.diagnosticId })}\n\n`);
        res.end();
    });

    proc.on('close', () => { if (!res.writableEnded) res.end(); });
    req.on('close', () => { proc.kill(); });
});

export default router;
export { appLogsRouter, parseLogConfig, buildLogBlock, updateGlobalBlock, extractGlobalBlock, extractDirectiveBlock };

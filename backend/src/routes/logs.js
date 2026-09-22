import { Router } from 'express';
import { caddyLoad } from '../caddy.js';
import { readContainerFile, writeContainerFile } from '../containerFs.js';
import { dockerExec } from '../docker.js';
import logger from '../logger.js';
const router = Router();
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

    const lines = content.split('\n');
    let globalLines = [];
    let inGlobal = false;
    let depth = 0;
    let globalDone = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!globalDone && !inGlobal && trimmed === '{') {
            inGlobal = true;
            depth = 1;
            globalLines.push(line);
            continue;
        }
        if (inGlobal) {
            globalLines.push(line);
            for (const ch of line) {
                if (ch === '{') depth++;
                if (ch === '}') depth--;
            }
            if (depth === 0) {
                inGlobal = false;
                globalDone = true;
            }
        }
    }

    if (!globalLines.length) return defaultConfig;
    const globalBlock = globalLines.join('\n');

    const logMatch = globalBlock.match(/\blog\s*\{([\s\S]*?)\n\t?\}/m);
    if (!logMatch) return defaultConfig;

    const logBlock = logMatch[1];
    const config = { ...defaultConfig, enabled: true };

    const fileMatch = logBlock.match(/output\s+file\s+(\S+)/);
    if (fileMatch) config.path = fileMatch[1];

    const rollSizeMatch = logBlock.match(/roll_size\s+(\S+)/);
    if (rollSizeMatch) config.rollSize = rollSizeMatch[1];

    const rollKeepMatch = logBlock.match(/roll_keep\s+(\d+)/);
    if (rollKeepMatch) config.rollKeep = parseInt(rollKeepMatch[1]);

    const formatMatch = logBlock.match(/format\s+(\S+)/);
    if (formatMatch) config.format = formatMatch[1];

    const levelMatch = logBlock.match(/level\s+(\S+)/);
    if (levelMatch) config.level = levelMatch[1].toUpperCase();

    return config;
}

function buildLogBlock(config) {
    if (!config.enabled) return null;

    return `\tlog {
\t\toutput file ${config.path} {
\t\t\troll_size ${config.rollSize}
\t\t\troll_keep ${config.rollKeep}
\t\t}
\t\tformat ${config.format}
\t\tlevel ${config.level}
\t}`;
}

function updateGlobalBlock(content, logConfig) {
    const logBlock = buildLogBlock(logConfig);

    const globalMatch = content.match(/^\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/ms);

    if (!globalMatch) {
        if (!logBlock) return content;
        return `{\n${logBlock}\n}\n\n${content.trim()}\n`;
    }

    const fullGlobal = globalMatch[0];
    const innerGlobal = globalMatch[1];

    const withoutLog = innerGlobal.replace(/\n?\s*log\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/ms, '');

    const newInner = logBlock
        ? `${withoutLog.trimEnd()}\n${logBlock}\n`
        : withoutLog;

    const newGlobal = `{${newInner}}`;
    return content.replace(fullGlobal, newGlobal);
}

// ── Routes ────────────────────────────────────────────────────────────────────

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

    const { adminUrl, containerName, configPath } = req.instance;
    logger.info(`Log config update requested`, { enabled: config.enabled });
    const content = await readContainerFile(containerName, configPath);
    const updated = updateGlobalBlock(content, config);

    try {
        const validateRes = await fetch(`${adminUrl}/adapt?adapter=caddyfile`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/caddyfile', 'Origin': 'http://0.0.0.0:2019' },
            body: updated,
        });
        if (!validateRes.ok) {
            const text = await validateRes.text();
            const lines = text.split('\n').filter(Boolean);
            const errors = lines.filter(l => l.toLowerCase().includes('error'));
            logger.warn(`Log config validation failed`, { errors });
            return res.status(422).json({ errors: errors.length ? errors : lines });
        }
    } catch (err) {
        logger.error(`Log config validation error`, { error: err.message });
        return res.status(422).json({ errors: [err.message] });
    }

    await writeContainerFile(containerName, configPath, updated);
    await caddyLoad(updated, adminUrl);
    logger.info(`Log config saved and reloaded`);
    res.json({ ok: true, message: 'Log config saved and reloaded' });
});

router.get('/', async (req, res) => {
    const { logPath, containerName } = req.instance;
    try {
        const { stdout } = await dockerExec(['tail', '-n', String(TAIL_LINES), logPath], undefined, containerName);
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

    const { spawn } = await import('child_process');
    const proc = spawn('docker', ['exec', containerName, 'tail', '-n', '0', '-f', logPath]);
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
        if (msg) res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    });

    proc.on('error', () => {
        res.write(`data: ${JSON.stringify({ error: `Log file not found at ${logPath}` })}\n\n`);
        res.end();
    });

    proc.on('close', () => { if (!res.writableEnded) res.end(); });
    req.on('close', () => { proc.kill(); });
});

export default router;
export { parseLogConfig, buildLogBlock, updateGlobalBlock };

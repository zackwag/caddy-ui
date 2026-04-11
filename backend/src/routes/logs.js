import { spawn } from 'child_process';
import { Router } from 'express';
import { createReadStream, unwatchFile, watchFile } from 'fs';
import { readFile, stat, writeFile } from 'fs/promises';
import { caddyLoad } from '../caddy.js';

const router = Router();
const LOG_PATH = process.env.CADDY_LOG_PATH || '/var/log/caddy/access.log';
const CADDYFILE_PATH = process.env.CADDYFILE_PATH || '/etc/caddy/Caddyfile';
const CADDY_CONTAINER = process.env.CADDY_CONTAINER_NAME || 'caddy';
const TAIL_LINES = 200;

function dockerExec(args, input) {
    return new Promise((resolve, reject) => {
        const proc = spawn('docker', ['exec', '-i', CADDY_CONTAINER, ...args]);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('close', code => {
            if (code === 0) resolve({ stdout, stderr });
            else reject(Object.assign(new Error(stderr.trim() || stdout.trim()), { stdout, stderr, code }));
        });
        proc.on('error', err => {
            reject(Object.assign(err, { stdout, stderr: err.message, code: null }));
        });
        if (input) {
            proc.stdin.write(input);
            proc.stdin.end();
        }
    });
}

async function validateCaddyfile(content) {
    await dockerExec(['caddy', 'validate', '--config', '-', '--adapter', 'caddyfile'], content);
}

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

    // Match the global block -- first { } block that isn't a site block
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

    // Find log block inside global
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

    // Check if global block exists
    const globalMatch = content.match(/^\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/ms);

    if (!globalMatch) {
        // No global block -- create one if logging enabled
        if (!logBlock) return content;
        return `{\n${logBlock}\n}\n\n${content.trim()}\n`;
    }

    const fullGlobal = globalMatch[0];
    const innerGlobal = globalMatch[1];

    // Remove existing log block from global
    const withoutLog = innerGlobal.replace(/\n?\s*log\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/ms, '');

    // Build new global inner content
    const newInner = logBlock
        ? `${withoutLog.trimEnd()}\n${logBlock}\n`
        : withoutLog;

    const newGlobal = `{${newInner}}`;
    return content.replace(fullGlobal, newGlobal);
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/config', async (req, res) => {
    const content = await readFile(CADDYFILE_PATH, 'utf8');
    const config = parseLogConfig(content);
    res.json(config);
});

router.put('/config', async (req, res) => {
    const config = req.body;
    if (!config || typeof config !== 'object') {
        return res.status(400).json({ error: 'Invalid log config' });
    }

    const content = await readFile(CADDYFILE_PATH, 'utf8');
    const updated = updateGlobalBlock(content, config);

    try {
        await validateCaddyfile(updated);
    } catch (err) {
        const output = ((err.stdout || '') + (err.stderr || '')).trim();
        const lines = output.split('\n').filter(Boolean);
        const errors = lines.filter(l => l.toLowerCase().includes('error'));
        return res.status(422).json({ errors: errors.length ? errors : [err.message] });
    }

    await writeFile(CADDYFILE_PATH, updated, 'utf8');
    await caddyLoad(updated);

    res.json({ ok: true, message: 'Log config saved and reloaded' });
});

router.get('/', async (req, res) => {
    try {
        await stat(LOG_PATH);
    } catch {
        return res.json({ lines: [], error: `Log file not found at ${LOG_PATH}` });
    }
    const lines = await tailFile(LOG_PATH, TAIL_LINES);
    res.json({ lines, path: LOG_PATH });
});

router.get('/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fileSize;
    try {
        const s = await stat(LOG_PATH);
        fileSize = s.size;
    } catch {
        res.write(`data: ${JSON.stringify({ error: `Log file not found at ${LOG_PATH}` })}\n\n`);
        res.end();
        return;
    }

    const onFileChange = async () => {
        try {
            const s = await stat(LOG_PATH);
            if (s.size <= fileSize) return;
            const stream = createReadStream(LOG_PATH, { start: fileSize, end: s.size });
            let buffer = '';
            stream.on('data', chunk => { buffer += chunk.toString(); });
            stream.on('end', () => {
                fileSize = s.size;
                const newLines = buffer.split('\n').filter(Boolean);
                for (const line of newLines) {
                    res.write(`data: ${JSON.stringify({ line })}\n\n`);
                }
            });
        } catch (err) {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        }
    };

    watchFile(LOG_PATH, { interval: 1000 }, onFileChange);
    req.on('close', () => { unwatchFile(LOG_PATH, onFileChange); });
});

async function tailFile(filePath, numLines) {
    return new Promise((resolve, reject) => {
        const lines = [];
        let remainder = '';
        const stream = createReadStream(filePath, { encoding: 'utf8' });
        stream.on('data', chunk => {
            const parts = (remainder + chunk).split('\n');
            remainder = parts.pop();
            lines.push(...parts.filter(Boolean));
        });
        stream.on('end', () => {
            if (remainder) lines.push(remainder);
            resolve(lines.slice(-numLines));
        });
        stream.on('error', reject);
    });
}

export default router;

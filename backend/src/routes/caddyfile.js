import { exec } from 'child_process';
import { Router } from 'express';
import { createReadStream } from 'fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { CADDY_ADMIN_URL, caddyLoad } from '../caddy.js';

const execAsync = promisify(exec);
const router = Router();
const CADDY_CONFIG_PATH = process.env.CADDY_CONFIG_PATH || '/etc/caddy/Caddyfile';
const HISTORY_PATH = process.env.HISTORY_PATH || '/etc/caddy-ui/history';
const MAX_HISTORY = 20;

async function ensureHistoryDir() {
    try {
        await mkdir(HISTORY_PATH, { recursive: true });
    } catch { }
}

async function snapshotCaddyfile() {
    try {
        await ensureHistoryDir();
        const content = await readFile(CADDY_CONFIG_PATH, 'utf8');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `Caddyfile-${timestamp}`;
        await writeFile(join(HISTORY_PATH, filename), content, 'utf8');
        await pruneHistory();
    } catch (err) {
        console.warn('Failed to snapshot Caddyfile:', err.message);
    }
}

async function pruneHistory() {
    try {
        const files = await readdir(HISTORY_PATH);
        const sorted = files
            .filter(f => f.startsWith('Caddyfile-'))
            .sort()
            .reverse();
        for (const file of sorted.slice(MAX_HISTORY)) {
            await unlink(join(HISTORY_PATH, file)).catch(() => { });
        }
    } catch { }
}

async function fmtCaddyfile(content) {
    try {
        const { stdout } = await execAsync('caddy fmt -', { input: content });
        return stdout || content;
    } catch (err) {
        console.warn('caddy fmt failed, skipping:', err.message);
        return content;
    }
}

async function validateCaddyfile(content) {
    const validateRes = await fetch(`${CADDY_ADMIN_URL}/adapt?adapter=caddyfile`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/caddyfile', 'Origin': 'http://0.0.0.0:2019' },
        body: content,
    });
    if (!validateRes.ok) {
        const text = await validateRes.text();
        const err = new Error(text);
        err.stderr = text;
        err.stdout = '';
        throw err;
    }
}

function parseSiteBlocks(content) {
    const lines = content.split('\n');
    const blocks = [];
    let current = null;
    let depth = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (current === null) {
            if (trimmed === '' || trimmed.startsWith('#')) continue;
            if (trimmed.endsWith('{')) {
                current = { header: trimmed, lines: [line] };
                depth = 1;
            }
        } else {
            current.lines.push(line);
            for (const ch of line) {
                if (ch === '{') depth++;
                if (ch === '}') depth--;
            }
            if (depth === 0) {
                blocks.push({ ...current });
                current = null;
            }
        }
    }

    return blocks;
}

function sortCaddyfile(content) {
    const lines = content.split('\n');
    let globalBlock = [];
    let rest = [];
    let inGlobal = false;
    let depth = 0;
    let globalDone = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!globalDone && !inGlobal && trimmed === '{') {
            inGlobal = true;
            depth = 1;
            globalBlock.push(line);
            continue;
        }
        if (inGlobal) {
            globalBlock.push(line);
            for (const ch of line) {
                if (ch === '{') depth++;
                if (ch === '}') depth--;
            }
            if (depth === 0) { inGlobal = false; globalDone = true; }
            continue;
        }
        rest.push(line);
    }

    const blocks = parseSiteBlocks(rest.join('\n'));
    const httpBlocks = [];
    const internalBlocks = [];
    const publicBlocks = [];

    for (const block of blocks) {
        const h = block.header.toLowerCase();
        if (h.startsWith('http://')) httpBlocks.push(block);
        else if (h.includes('.internal')) internalBlocks.push(block);
        else publicBlocks.push(block);
    }

    const sortByHeader = (a, b) => a.header.localeCompare(b.header);
    publicBlocks.sort(sortByHeader);
    internalBlocks.sort(sortByHeader);
    httpBlocks.sort(sortByHeader);

    const sorted = [...publicBlocks, ...internalBlocks, ...httpBlocks];
    const parts = [];
    if (globalBlock.length) parts.push(globalBlock.join('\n'));
    for (const block of sorted) parts.push(block.lines.join('\n'));

    return parts.join('\n\n').trimEnd() + '\n';
}

// GET /api/caddyfile
// GET /api/caddyfile?download=true
router.get('/', async (req, res) => {
    const content = await readFile(CADDY_CONFIG_PATH, 'utf8');
    if (req.query.download === 'true') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        res.setHeader('Content-Disposition', `attachment; filename="Caddyfile-${timestamp}"`);
        res.setHeader('Content-Type', 'text/plain');
        createReadStream(CADDY_CONFIG_PATH).pipe(res);
        return;
    }
    res.type('text/plain').send(content);
});

// GET /api/caddyfile/history
router.get('/history', async (req, res) => {
    await ensureHistoryDir();
    try {
        const files = await readdir(HISTORY_PATH);
        const snapshots = files
            .filter(f => f.startsWith('Caddyfile-'))
            .sort()
            .reverse()
            .map(filename => {
                const ts = filename
                    .replace('Caddyfile-', '')
                    .replace(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/, '$1T$2:$3:$4');
                return { filename, timestamp: ts };
            });
        res.json(snapshots);
    } catch {
        res.json([]);
    }
});

// GET /api/caddyfile/history/:filename
router.get('/history/:filename', async (req, res) => {
    const { filename } = req.params;
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    const content = await readFile(join(HISTORY_PATH, filename), 'utf8');
    res.type('text/plain').send(content);
});

// DELETE /api/caddyfile/history/:filename
router.delete('/history/:filename', async (req, res) => {
    const { filename } = req.params;
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    await unlink(join(HISTORY_PATH, filename));
    res.json({ ok: true });
});

// POST /api/caddyfile/validations
router.post('/validations', async (req, res) => {
    const content = req.body;
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Body must be plain text Caddyfile content' });
    }
    try {
        await validateCaddyfile(content);
        res.json({ valid: true, warnings: [] });
    } catch (err) {
        const output = ((err.stdout || '') + (err.stderr || '')).trim();
        const lines = output.split('\n').filter(Boolean);
        const warnings = lines.filter(l => l.toLowerCase().includes('warn'));
        const errors = lines.filter(l => l.toLowerCase().includes('error'));
        res.status(422).json({ valid: false, errors: errors.length ? errors : [err.message], warnings });
    }
});

// POST /api/caddyfile/reloads
router.post('/reloads', async (req, res) => {
    const content = await readFile(CADDY_CONFIG_PATH, 'utf8');
    await caddyLoad(content);
    res.json({ ok: true, message: 'Caddy reloaded from disk' });
});

// PUT /api/caddyfile
router.put('/', async (req, res) => {
    const content = req.body;
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Body must be plain text Caddyfile content' });
    }

    const fmt = req.query.fmt !== 'false';
    const sort = req.query.sort !== 'false';

    try {
        await validateCaddyfile(content);
    } catch (err) {
        const output = ((err.stdout || '') + (err.stderr || '')).trim();
        const lines = output.split('\n').filter(Boolean);
        const errors = lines.filter(l => l.toLowerCase().includes('error'));
        return res.status(422).json({ valid: false, errors: errors.length ? errors : [err.message] });
    }

    await snapshotCaddyfile();
    await caddyLoad(content);

    let final = content;
    if (fmt) final = await fmtCaddyfile(final);
    if (sort) final = sortCaddyfile(final);

    await writeFile(CADDY_CONFIG_PATH, final, 'utf8');
    res.json({ ok: true, message: 'Caddyfile saved and reloaded' });
});

export default router;

import { exec } from 'child_process';
import { Router } from 'express';
import { createReadStream } from 'fs';
import { readFile, unlink, writeFile } from 'fs/promises';
import { promisify } from 'util';
import { caddyLoad } from '../caddy.js';

const execAsync = promisify(exec);
const router = Router();
const CADDYFILE_PATH = process.env.CADDYFILE_PATH || '/etc/caddy/Caddyfile';

async function fmtCaddyfile() {
    try {
        await execAsync(`caddy fmt --overwrite ${CADDYFILE_PATH}`);
    } catch (err) {
        console.warn('caddy fmt failed:', err.message);
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
            if (depth === 0) {
                inGlobal = false; globalDone = true;
            }
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
router.get('/', async (req, res) => {
    const content = await readFile(CADDYFILE_PATH, 'utf8');
    res.type('text/plain').send(content);
});

// GET /api/caddyfile/download
router.get('/download', async (req, res) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Disposition', `attachment; filename="Caddyfile-${timestamp}"`);
    res.setHeader('Content-Type', 'text/plain');
    createReadStream(CADDYFILE_PATH).pipe(res);
});

// POST /api/caddyfile/validate
router.post('/validate', async (req, res) => {
    const content = req.body;
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Body must be plain text Caddyfile content' });
    }

    const tmpPath = `/tmp/Caddyfile.validate.${Date.now()}`;
    try {
        await writeFile(tmpPath, content, 'utf8');
        const { stdout, stderr } = await execAsync(`caddy validate --config ${tmpPath} --adapter caddyfile 2>&1`);
        const output = (stdout + stderr).trim();
        const lines = output.split('\n').filter(Boolean);
        const warnings = lines.filter(l => l.toLowerCase().includes('warn'));
        const errors = lines.filter(l => l.toLowerCase().includes('error'));
        if (errors.length) return res.status(422).json({ valid: false, errors, warnings });
        res.json({ valid: true, warnings, output });
    } catch (err) {
        const output = (err.stdout + err.stderr).trim();
        const lines = output.split('\n').filter(Boolean);
        const errors = lines.filter(l => l.toLowerCase().includes('error') || l.includes('Error'));
        const warnings = lines.filter(l => l.toLowerCase().includes('warn'));
        res.status(422).json({ valid: false, errors: errors.length ? errors : lines, warnings });
    } finally {
        unlink(tmpPath).catch(() => { });
    }
});

// POST /api/caddyfile/reload
router.post('/reload', async (req, res) => {
    const content = await readFile(CADDYFILE_PATH, 'utf8');
    await caddyLoad(content);
    res.json({ ok: true, message: 'Caddy reloaded from disk' });
});

// POST /api/caddyfile/restore
router.post('/restore', async (req, res) => {
    const content = req.body;
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Body must be plain text Caddyfile content' });
    }

    const tmpPath = `/tmp/Caddyfile.restore.${Date.now()}`;
    try {
        await writeFile(tmpPath, content, 'utf8');
        await execAsync(`caddy validate --config ${tmpPath} --adapter caddyfile 2>&1`);
    } catch (err) {
        const output = (err.stdout + err.stderr).trim();
        const lines = output.split('\n').filter(Boolean);
        const errors = lines.filter(l => l.toLowerCase().includes('error'));
        unlink(tmpPath).catch(() => { });
        return res.status(422).json({ errors: errors.length ? errors : lines });
    } finally {
        unlink(tmpPath).catch(() => { });
    }

    await caddyLoad(content);
    await writeFile(CADDYFILE_PATH, content, 'utf8');
    res.json({ ok: true, message: 'Caddyfile restored and reloaded' });
});

// PUT /api/caddyfile
router.put('/', async (req, res) => {
    const content = req.body;
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Body must be plain text Caddyfile content' });
    }

    const fmt = req.query.fmt !== 'false';
    const sort = req.query.sort !== 'false';

    const tmpPath = `/tmp/Caddyfile.save.${Date.now()}`;
    try {
        await writeFile(tmpPath, content, 'utf8');
        await execAsync(`caddy validate --config ${tmpPath} --adapter caddyfile 2>&1`);
    } catch (err) {
        const output = (err.stdout + err.stderr).trim();
        const lines = output.split('\n').filter(Boolean);
        const errors = lines.filter(l => l.toLowerCase().includes('error'));
        unlink(tmpPath).catch(() => { });
        return res.status(422).json({ valid: false, errors: errors.length ? errors : lines });
    } finally {
        unlink(tmpPath).catch(() => { });
    }

    await caddyLoad(content);
    await writeFile(CADDYFILE_PATH, content, 'utf8');

    if (fmt) await fmtCaddyfile();

    if (sort) {
        const formatted = await readFile(CADDYFILE_PATH, 'utf8');
        const sorted = sortCaddyfile(formatted);
        await writeFile(CADDYFILE_PATH, sorted, 'utf8');
    }

    res.json({ ok: true, message: 'Caddyfile saved and reloaded' });
});

export default router;

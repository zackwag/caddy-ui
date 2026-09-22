import { Router } from 'express';
import { createReadStream } from 'fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { caddyLoad, withTimeout } from '../caddy.js';
import { dockerExec } from '../docker.js';
import logger from '../logger.js';

const router = Router();
const HISTORY_PATH = process.env.HISTORY_PATH || '/etc/caddy-ui/history';
const MAX_HISTORY = 20;

function instanceHistoryDir(instanceId) {
    return instanceId && instanceId !== 'default'
        ? join(HISTORY_PATH, instanceId)
        : HISTORY_PATH;
}

async function ensureHistoryDir(instanceId) {
    try {
        await mkdir(instanceHistoryDir(instanceId), { recursive: true });
    } catch { }
}

async function snapshotCaddyfile(configPath, instanceId) {
    try {
        await ensureHistoryDir(instanceId);
        const dir = instanceHistoryDir(instanceId);
        const content = await readFile(configPath, 'utf8');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `Caddyfile-${timestamp}`;
        await writeFile(join(dir, filename), content, 'utf8');
        await pruneHistory(instanceId);
        logger.info(`Caddyfile snapshot created`, { filename, instanceId });
    } catch (err) {
        logger.warn(`Failed to snapshot Caddyfile`, { error: err.message });
    }
}

async function pruneHistory(instanceId) {
    try {
        const dir = instanceHistoryDir(instanceId);
        const files = await readdir(dir);
        const sorted = files
            .filter(f => f.startsWith('Caddyfile-'))
            .sort()
            .reverse();
        for (const file of sorted.slice(MAX_HISTORY)) {
            await unlink(join(dir, file)).catch(() => { });
        }
    } catch { }
}

async function fmtCaddyfile(content, containerName) {
    try {
        const { stdout } = await dockerExec(['caddy', 'fmt', '-'], content, containerName);
        return stdout || content;
    } catch (err) {
        logger.warn('caddy fmt failed', { error: err.message });
        return content;
    }
}

const ADAPT_TIMEOUT_MS = 10000;

// Distinguish "Docker/caddy binary isn't reachable from this container" from a
// genuine Caddyfile error reported by `caddy adapt`.
function isDockerUnavailable(err) {
    if (!err) return false;
    if (err.code === null || err.code === undefined) return true;
    const msg = `${err.stderr || ''} ${err.stdout || ''} ${err.message || ''}`.toLowerCase();
    return /cannot connect to the docker daemon|is the docker daemon running|no such container|permission denied while trying to connect|docker:? (?:command )?not found|executable file not found|not found in \$path/.test(msg);
}

async function adaptViaAdminApi(content, adminUrl) {
    const res = await withTimeout(
        fetch(`${adminUrl}/adapt?adapter=caddyfile`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/caddyfile', 'Origin': 'http://0.0.0.0:2019' },
            body: content,
        }),
        ADAPT_TIMEOUT_MS,
        'POST /adapt'
    );
    if (!res.ok) {
        const text = await res.text();
        const err = new Error(text);
        err.stderr = text;
        err.stdout = '';
        throw err;
    }
}

// Adapt through the caddy binary in the Caddy container, writing the buffer to a
// temp file next to the real Caddyfile so relative `import` paths resolve.
async function adaptViaCaddyBinary(content, configPath, containerName) {
    const tmp = join(dirname(configPath), `.caddy-ui-adapt-${process.pid}-${Date.now()}.tmp`);
    const script = `cat > '${tmp}' && caddy adapt --config '${tmp}' --adapter caddyfile > /dev/null; rc=$?; rm -f '${tmp}'; exit $rc`;
    await dockerExec(['sh', '-c', script], content, containerName);
}

async function validateCaddyfile(content, { adminUrl, configPath, containerName }) {
    try {
        await adaptViaAdminApi(content, adminUrl);
        return;
    } catch (adminErr) {
        try {
            await adaptViaCaddyBinary(content, configPath, containerName);
            logger.info('Caddyfile validated via caddy binary (admin API adapt failed)');
            return;
        } catch (caddyErr) {
            if (isDockerUnavailable(caddyErr)) throw adminErr;
            throw caddyErr;
        }
    }
}

async function reloadViaCaddyBinary(configPath, containerName) {
    await dockerExec(['caddy', 'reload', '--config', configPath, '--adapter', 'caddyfile'], undefined, containerName);
}

async function reloadCaddy(content, { adminUrl, configPath, containerName }) {
    try {
        await caddyLoad(content, adminUrl);
        return;
    } catch (loadErr) {
        try {
            await reloadViaCaddyBinary(configPath, containerName);
            logger.info('Caddy reloaded via caddy binary (admin /load failed)');
            return;
        } catch (caddyErr) {
            if (isDockerUnavailable(caddyErr)) throw loadErr;
            throw caddyErr;
        }
    }
}

function parseSiteBlocks(content) {
    const lines = content.split('\n');
    const blocks = [];
    const loose = [];
    let current = null;
    let depth = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (current === null) {
            if (trimmed === '' || trimmed.startsWith('#')) continue;
            if (trimmed.endsWith('{')) {
                current = { header: trimmed, lines: [line] };
                depth = 1;
            } else {
                // Top-level line that is not a site block, e.g. `import
                // conf.d/*.caddy`. Keep it verbatim instead of dropping it.
                loose.push(line);
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

    return { blocks, loose };
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

    const { blocks, loose } = parseSiteBlocks(rest.join('\n'));
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
    if (loose.length) parts.push(loose.join('\n'));
    for (const block of sorted) parts.push(block.lines.join('\n'));

    return parts.join('\n\n').trimEnd() + '\n';
}

// GET /api/caddyfile
// GET /api/caddyfile?download=true
router.get('/', async (req, res) => {
    const configPath = req.instance.configPath;
    const content = await readFile(configPath, 'utf8');
    if (req.query.download === 'true') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        res.setHeader('Content-Disposition', `attachment; filename="Caddyfile-${timestamp}"`);
        res.setHeader('Content-Type', 'text/plain');
        createReadStream(configPath).pipe(res);
        return;
    }
    res.type('text/plain').send(content);
});

// GET /api/caddyfile/history
router.get('/history', async (req, res) => {
    const dir = instanceHistoryDir(req.instance.id);
    await ensureHistoryDir(req.instance.id);
    try {
        const files = await readdir(dir);
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
    const dir = instanceHistoryDir(req.instance.id);
    const content = await readFile(join(dir, filename), 'utf8');
    res.type('text/plain').send(content);
});

// DELETE /api/caddyfile/history/:filename
router.delete('/history/:filename', async (req, res) => {
    const { filename } = req.params;
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    const dir = instanceHistoryDir(req.instance.id);
    await unlink(join(dir, filename));
    res.json({ ok: true });
});

// POST /api/caddyfile/validations
router.post('/validations', async (req, res) => {
    const content = req.body;
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Body must be plain text Caddyfile content' });
    }

    const fmt = req.query.fmt === 'true';
    logger.info(`Validating Caddyfile`, { bytes: content.length, fmt });

    try {
        await validateCaddyfile(content, req.instance);
        logger.info(`Caddyfile adapt validation passed`);
    } catch (err) {
        const output = ((err.stdout || '') + (err.stderr || '')).trim();
        const lines = output.split('\n').filter(Boolean);
        const warnings = lines.filter(l => l.toLowerCase().includes('warn'));
        const errors = lines.filter(l => l.toLowerCase().includes('error'));
        logger.warn(`Caddyfile adapt validation failed`, { errors });
        return res.status(422).json({ valid: false, errors: errors.length ? errors : [err.message], warnings });
    }

    let formatted = null;
    if (fmt) {
        try {
            formatted = await fmtCaddyfile(content, req.instance.containerName);
            logger.info(`Caddyfile fmt passed`);
        } catch (err) {
            logger.warn(`Caddyfile fmt failed`, { error: err.message });
            return res.status(422).json({ valid: false, errors: [`caddy fmt failed: ${err.message}`], warnings: [] });
        }
    }

    res.json({ valid: true, warnings: [], ...(formatted ? { formatted } : {}) });
});

// POST /api/caddyfile/reloads
router.post('/reloads', async (req, res) => {
    logger.info(`Caddyfile reload requested`);
    const content = await readFile(req.instance.configPath, 'utf8');
    await reloadCaddy(content, req.instance);
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
    const skipValidation = req.query.validate === 'false';
    logger.info(`Saving Caddyfile`, { bytes: content.length, fmt, sort, skipValidation });

    const { configPath, containerName } = req.instance;

    if (skipValidation) {
        logger.warn(`Caddyfile save requested without validation (force save)`);
    } else {
        try {
            await validateCaddyfile(content, req.instance);
            logger.info(`Caddyfile pre-save validation passed`);
        } catch (err) {
            const output = ((err.stdout || '') + (err.stderr || '')).trim();
            const lines = output.split('\n').filter(Boolean);
            const errors = lines.filter(l => l.toLowerCase().includes('error'));
            logger.warn(`Caddyfile pre-save validation failed`, { errors });
            return res.status(422).json({ valid: false, errors: errors.length ? errors : [err.message] });
        }
    }

    await snapshotCaddyfile(configPath, req.instance.id);

    let final = content;
    if (fmt) {
        try {
            final = await fmtCaddyfile(final, containerName);
            logger.info(`Caddyfile formatted`);
        } catch (err) {
            logger.warn(`caddy fmt failed`, { error: err.message });
            return res.status(422).json({ valid: false, errors: [`caddy fmt failed: ${err.message}`] });
        }
    }
    if (sort) {
        final = sortCaddyfile(final);
        logger.info(`Caddyfile sorted`);
    }

    const previous = await readFile(configPath, 'utf8').catch(() => null);
    await writeFile(configPath, final, 'utf8');

    try {
        await reloadCaddy(final, req.instance);
    } catch (err) {
        if (!skipValidation) {
            if (previous !== null) await writeFile(configPath, previous, 'utf8').catch(() => { });
            logger.warn(`Caddy reload failed, save rolled back`, { error: err.message });
            return res.status(422).json({ valid: false, errors: [`Caddy reload failed: ${err.message}`] });
        }
        logger.warn(`Caddy reload failed after force save; file left on disk`, { error: err.message });
        return res.json({
            ok: true,
            message: 'Caddyfile written to disk. Caddy reload failed — changes apply on the next restart or manual reload.',
            warning: err.message,
        });
    }

    logger.info(`Caddyfile saved`, { bytes: final.length });
    res.json({ ok: true, message: 'Caddyfile saved and reloaded' });
});

export default router;
export { parseSiteBlocks, sortCaddyfile };

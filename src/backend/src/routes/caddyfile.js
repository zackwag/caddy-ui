import { Router } from 'express';
import { AppError, asAppError } from '../AppError.js';
import { audited } from '../auditLog.js';
import { caddyfileETag, changeResultFields, readCaddyfile, reloadCaddyfile, saveCaddyfileChange } from '../caddyfileChange.js';
import { describeValidationFailure, fmtCaddyfile, validateCaddyfile } from '../caddyfileRuntime.js';
import { sortCaddyfile } from '../caddyfileSort.js';
import { configurationHistory as history } from '../configurationHistory.js';
import { sendFailure } from '../errorReporting.js';
import logger from '../logger.js';
import { getAuthentication } from '../middleware/auth.js';

const router = Router();

// The ETags an If-Match header lists, or null without one. A weak ETag counts
// as its strong form: nginx weakens ETags when it compresses a response, and
// the tag is still the hash of the uncompressed text.
function ifMatchTags(header) {
    if (!header) {
        return null;
    }
    return header.split(',').map(tag => tag.trim().replace(/^W\//, '')).filter(Boolean);
}

// Checked where it's used, not in middleware, so CodeQL sees the guard.
function caddyfileText(req) {
    const content = req.body;
    if (typeof content !== 'string' || !content) {
        throw new AppError('VALIDATION_FAILED', { context: { field: 'content' } });
    }
    return content;
}

// Responds and resolves to false when Caddy rejects the content.
async function validOrRespond(content, req, res) {
    try {
        await validateCaddyfile(content, req.instance);
        logger.info('Caddyfile validation passed');
        return true;
    } catch (err) {
        const failure = describeValidationFailure(err);
        logger.warn('Caddyfile validation failed', { errors: failure.errors });
        sendFailure(res, new AppError('CADDYFILE_VALIDATION_FAILED', { cause: err }), { valid: false, ...failure });
        return false;
    }
}

// GET /api/caddyfile
// GET /api/caddyfile?download=true
router.get('/', async (req, res) => {
    const content = await readCaddyfile(req.instance);
    // The editor sends this back as If-Match, so a save can't overwrite edits
    // made since it loaded the file. Never cached: the file changes outside caddy/ui.
    res.setHeader('ETag', caddyfileETag(content));
    res.setHeader('Cache-Control', 'no-store');
    if (req.query.download === 'true') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        res.setHeader('Content-Disposition', `attachment; filename="Caddyfile-${timestamp}"`);
    }
    res.type('text/plain').send(content);
});

// GET /api/caddyfile/history
router.get('/history', async (req, res) => {
    let entries;
    try {
        entries = await history.list(req.instance.id, actor => getAuthentication().resolveActor(actor));
    } catch (err) {
        throw asAppError(err, 'CADDYFILE_HISTORY_READ_FAILED', { instanceId: req.instance.id });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(entries);
});

router.param('filename', (req, res, next, filename) => {
    if (!history.validFilename(filename)) {
        throw new AppError('VALIDATION_FAILED', { context: { field: 'filename' } });
    }
    next();
});

// The requested history version. NOT_FOUND when there is no such version.
async function readVersion(req) {
    try {
        return await history.read(req.instance.id, req.params.filename);
    } catch (error) {
        throw asAppError(error, error.code === 'ENOENT' ? 'NOT_FOUND' : 'CADDYFILE_HISTORY_READ_FAILED', { instanceId: req.instance.id });
    }
}

// GET /api/caddyfile/history/:filename/changes
router.get('/history/:filename/changes', async (req, res) => {
    const version = await readVersion(req);
    // Only external observations record changes
    if (!version.external) {
        throw new AppError('NOT_FOUND');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(version.external);
});

// GET /api/caddyfile/history/:filename
router.get('/history/:filename', async (req, res) => {
    const { content } = await readVersion(req);
    // An observation of a live JSON change has no Caddyfile to serve
    if (content === null) {
        throw new AppError('CONFLICT');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.type('text/plain').send(content);
});

// DELETE /api/caddyfile/history/:filename
router.delete('/history/:filename', async (req, res) => {
    const { filename } = req.params;
    try {
        await audited(req, { action: 'history.delete', instanceId: req.instance.id, resource: filename },
            () => history.remove(req.instance.id, filename));
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
        throw new AppError('NOT_FOUND', { cause: error, context: { instanceId: req.instance.id } });
    }
    res.json({ ok: true });
});

// POST /api/caddyfile/validations
router.post('/validations', async (req, res) => {
    const content = caddyfileText(req);
    const fmt = req.query.fmt === 'true';
    logger.info(`Validating Caddyfile`, { bytes: content.length, fmt });
    if (!await validOrRespond(content, req, res)) {
        return;
    }
    res.json({ valid: true, warnings: [], ...(fmt ? { formatted: await fmtCaddyfile(content, req.instance) } : {}) });
});

// POST /api/caddyfile/reloads
router.post('/reloads', async (req, res) => {
    logger.info(`Caddyfile reload requested`);
    const result = await reloadCaddyfile(req.instance);
    res.json({ ok: true, message: 'Caddy reloaded from disk', ...changeResultFields(result) });
});

// PUT /api/caddyfile
router.put('/', async (req, res) => {
    const content = caddyfileText(req);
    const restoring = req.query.action === 'restore';
    const fmt = !restoring && req.query.fmt !== 'false';
    const sort = !restoring && req.query.sort !== 'false';
    const skipValidation = req.query.validate === 'false';
    logger.info(`Saving Caddyfile`, { bytes: content.length, fmt, sort, skipValidation });

    if (skipValidation) {
        logger.warn(`Caddyfile save requested without validation (force save)`);
    } else if (!await validOrRespond(content, req, res)) {
        return;
    }

    let final = fmt ? await fmtCaddyfile(content, req.instance) : content;
    if (sort) {
        // Sorting is cosmetic: a file Caddy accepted but the scanner can't
        // structure is saved as written rather than rejected.
        try {
            final = sortCaddyfile(final);
        } catch (err) {
            if (!(err instanceof SyntaxError)) {
                throw err;
            }
            logger.warn(`Caddyfile sort skipped`, { error: err.message });
        }
    }

    let result;
    try {
        const action = ['restore', 'import'].includes(req.query.action) ? `caddyfile.${req.query.action}` : 'caddyfile.save';
        // A force save keeps the file even when Caddy rejects it
        result = await saveCaddyfileChange(req.instance, final, { rollback: !skipValidation, actor: req.actor, action,
            ifMatch: ifMatchTags(req.get('If-Match')) });
    } catch (err) {
        if (!(err instanceof AppError)) {
            throw err;
        }
        const detail = err.cause?.message || err.message;
        const errors = [err.code === 'CADDYFILE_CHANGE_REJECTED' || err.code === 'CADDYFILE_ROLLBACK_FAILED' ? `Caddy reload failed: ${detail}` : detail];
        return sendFailure(res, err, { valid: false, errors });
    }
    if (result.uncertain) {
        return res.json({ ok: true, message: 'Caddyfile saved. Caddy did not confirm the reload in time.', ...changeResultFields(result) });
    }
    if (!result.applied) {
        logger.warn(`Caddy reload failed after force save; file left on disk`, { error: result.error.message });
        return res.json({
            ok: true,
            message: 'Caddyfile written to disk. Caddy reload failed — changes apply on the next restart or manual reload.',
            ...changeResultFields(result),
            warning: [result.error.message, result.warning].filter(Boolean).join(' '),
        });
    }

    logger.info(`Caddyfile saved`, { bytes: final.length });
    res.json({ ok: true, message: 'Caddyfile saved and reloaded', ...changeResultFields(result) });
});

export default router;

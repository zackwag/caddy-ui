import { Router } from 'express';
import { AppError, asAppError, errorChain, publicError } from '../AppError.js';
import { changeResultFields, readCaddyfile, saveCaddyfileChange } from '../caddyfileChange.js';
import { parseLogConfig, updateLogConfig, validateLogConfig } from '../caddyfileLogging.js';
import { validateCaddyfile } from '../caddyfileRuntime.js';
import { execInInstance, spawnInInstance } from '../docker.js';
import { errorDefinition } from '../errorRegistry.js';
import { openEventStream } from '../eventStream.js';
import { logReadError } from '../logReadError.js';
import logger, { getRecentLogEntries, subscribeToLogs } from '../logger.js';

const router = Router();
const appLogsRouter = Router();
const TAIL_LINES = 200;

appLogsRouter.get('/', (req, res) => {
    res.json({ entries: getRecentLogEntries(TAIL_LINES) });
});

appLogsRouter.get('/stream', (req, res) => {
    const send = openEventStream(res, () => unsubscribe());
    const unsubscribe = subscribeToLogs(entry => send({ entry }));
});

router.get('/config', async (req, res) => {
    const content = await readCaddyfile(req.instance);
    try {
        res.json(parseLogConfig(content));
    } catch (cause) {
        throw asAppError(cause, 'LOG_CONFIG_PARSE_FAILED', { instanceId: req.instance.id, configPath: req.instance.configPath });
    }
});

router.put('/config', async (req, res) => {
    const config = req.body;
    validateLogConfig(config);
    logger.info('Log config update requested', { enabled: config.enabled });
    let result;
    try {
        result = await saveCaddyfileChange(req.instance, async previous => {
            let updated;
            try {
                updated = updateLogConfig(previous, config);
            } catch (cause) {
                // The scanner couldn't structure the current file
                if (!(cause instanceof SyntaxError)) {
                    throw cause;
                }
                throw new AppError('LOG_CONFIG_PARSE_FAILED', { cause, context: { instanceId: req.instance.id } });
            }
            try {
                await validateCaddyfile(updated, req.instance);
            } catch (cause) {
                throw new AppError('CADDYFILE_VALIDATION_FAILED', { cause });
            }
            return updated;
        }, { actor: req.actor, action: 'logs.configure' });
    } catch (err) {
        throw asAppError(err, 'CADDYFILE_WRITE_FAILED', { instanceId: req.instance.id });
    }
    logger.info('Log config saved and reloaded');
    res.json({ ok: true, message: 'Log config saved and reloaded', ...changeResultFields(result) });
});

router.get('/', async (req, res) => {
    const { logPath, containerName } = req.instance;
    let stdout;
    try {
        ({ stdout } = await execInInstance(containerName, 'tail', ['-n', String(TAIL_LINES), '--', logPath]));
    } catch (cause) {
        throw logReadError(cause, req.instance);
    }
    res.json({ lines: stdout.split('\n').filter(Boolean), path: logPath });
});

router.get('/stream', async (req, res) => {
    const { logPath, containerName } = req.instance;
    let proc;
    const send = openEventStream(res, () => proc?.kill());

    let buffer = '';
    let stderr = '';
    let reported = false;
    const reportFailure = cause => {
        if (reported || res.destroyed || res.writableEnded) {
            return;
        }
        reported = true;
        const error = logReadError(cause, req.instance, 'LOG_STREAM_ERROR');
        logger[errorDefinition(error.code).level]('Caddy log stream failed', {
            requestId: req.diagnosticId, code: error.code, causes: errorChain(error),
        });
        send({ ...publicError(error), requestId: req.diagnosticId });
        res.end();
    };
    try { proc = spawnInInstance(containerName, 'tail', ['-n', '0', '-f', '--', logPath]); }
    catch (cause) { reportFailure(cause); return; }

    proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const parts = buffer.split('\n');
        buffer = parts.pop();
        for (const line of parts.filter(Boolean)) {
            send({ line });
        }
    });

    proc.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
    proc.on('error', reportFailure);
    proc.on('close', (code, signal) => {
        // A truncation warning on stderr is not a failed live stream. Wait for
        // close so a genuine failure includes all stderr, and report it once.
        if (code !== 0) {
            reportFailure(Object.assign(new Error(stderr.trim() || `tail exited (${code ?? signal})`), { stderr, code }));
        }
        if (!res.writableEnded) {
            res.end();
        }
    });
});

export default router;
export { appLogsRouter };

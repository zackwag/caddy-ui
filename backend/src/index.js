import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { loadInstances } from './instances.js';
import logger from './logger.js';
import { authMiddleware, publicMetrics } from './middleware/auth.js';
import { instanceMiddleware } from './middleware/instance.js';
import { initMonitor } from './notifications.js';
import authRouter from './routes/auth.js';
import caddyfileRouter from './routes/caddyfile.js';
import healthRouter from './routes/health.js';
import instancesRouter from './routes/instances.js';
import logsRouter from './routes/logs.js';
import metricsRouter from './routes/metrics.js';
import notificationsRouter from './routes/notifications.js';
import { initCaddyfileTitles } from './caddyfileTitles.js';
import routenotesRouter, { cleanupOrphanedNotes } from './routes/routenotes.js';
import routesRouter from './routes/routes.js';
import servernamesRouter from './routes/servernames.js';
import statusRouter from './routes/status.js';
import tlsRouter from './routes/tls.js';

const app = express();
const PORT = process.env.PORT || 3001;
const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || 'http://caddy:2019';
const APP_VERSION = process.env.APP_VERSION || 'dev';

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.text({ type: 'text/plain' }));

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const elapsed = Date.now() - start;
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        logger[level](`${req.method} ${req.path}`, {
            status: res.statusCode,
            elapsed,
            ip: req.ip,
        });
    });
    next();
});

const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 200,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
});

const authLimiter = rateLimit({
    windowMs: 60_000,
    limit: 15,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many login attempts, please try again later' },
});

app.use('/api', apiLimiter);

// Auth routes are always public
app.use('/api/auth', authLimiter, authRouter);

// GET /api/version -- always public, non-sensitive
app.get('/api/version', (req, res) => res.json({ version: APP_VERSION }));

// Instance routes require auth but not instance middleware
app.use('/api/instances', authMiddleware, instancesRouter);

// Instance middleware for all other routes
app.use('/api', instanceMiddleware);

// GET /api/metrics/raw -- Prometheus scrape endpoint
// Public if CADDY_UI_PUBLIC_METRICS=true, otherwise requires auth
app.get('/api/metrics/raw', publicMetrics ? (req, res, next) => next() : authMiddleware, async (req, res) => {
    try {
        const adminUrl = req.instance.adminUrl;
        const metricsRes = await fetch(`${adminUrl}/metrics`, {
            headers: { 'Origin': 'http://0.0.0.0:2019' },
        });
        if (!metricsRes.ok) throw new Error(`Metrics unavailable: ${metricsRes.status}`);
        const text = await metricsRes.text();
        res.setHeader('Content-Type', 'text/plain; version=0.0.4');
        res.send(text);
    } catch (err) {
        res.status(503).send(`# Metrics unavailable: ${err.message}\n`);
    }
});

// All other /api/* routes require auth if enabled
app.use('/api', authMiddleware);

app.use('/api/caddyfile', caddyfileRouter);
app.use('/api/routes', routesRouter);
app.use('/api/status', statusRouter);
app.use('/api/logs', logsRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/server-names', servernamesRouter);
app.use('/api/tls', tlsRouter);
app.use('/api/health', healthRouter);
app.use('/api/route-notes', routenotesRouter);
app.use('/api/notifications', notificationsRouter);

app.use((err, req, res, next) => {
    logger.error(`Unhandled error`, { method: req.method, path: req.path, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, async () => {
    await loadInstances();
    logger.info(`Caddy UI backend running`, { port: PORT, version: APP_VERSION });
    logger.info(`Caddy admin API`, { url: CADDY_ADMIN_URL });
    logger.info(`Caddyfile path`, { path: process.env.CADDY_CONFIG_PATH || '/etc/caddy/Caddyfile' });
    logger.info(`Public metrics`, { enabled: publicMetrics });
    initMonitor();
    initCaddyfileTitles().then(() => cleanupOrphanedNotes());
});

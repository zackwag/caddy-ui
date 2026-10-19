import express from 'express';
import rateLimit from 'express-rate-limit';
import { loadCustomThemes } from './customThemes.js';
import { getInstances, loadInstances } from './instances.js';
import logger from './logger.js';
import { diagnosticMiddleware } from './errorReporting.js';
import { authMiddleware, initializeAuthentication, publicMetrics } from './middleware/auth.js';
import { createCrossSiteMiddleware } from './middleware/crossSite.js';
import { createCsrfMiddleware } from './middleware/csrf.js';
import { createApiTokenMiddleware } from './middleware/apiToken.js';
import { instanceMiddleware } from './middleware/instance.js';
import { initMonitor } from './notifications.js';
import authRouter from './routes/auth.js';
import caddyfileRouter, { migrateLegacyHistory } from './routes/caddyfile.js';
import customThemesRouter from './routes/customThemes.js';
import healthRouter from './routes/health.js';
import instancesRouter from './routes/instances.js';
import logsRouter, { appLogsRouter } from './routes/logs.js';
import metricsRouter, { rawMetrics } from './routes/metrics.js';
import notificationsRouter from './routes/notifications.js';
import settingsRouter from './routes/settings.js';
import { initCaddyfileTitles } from './caddyfileTitles.js';
import routenotesRouter, { cleanupOrphanedNotes } from './routes/routenotes.js';
import routesRouter from './routes/routes.js';
import servernamesRouter from './routes/servernames.js';
import statusRouter from './routes/status.js';
import tlsRouter from './routes/tls.js';
import { startRouteMonitor } from './routeMonitor.js';
import { loadMaintenance } from './maintenance.js';
import { loadServerNames } from './serverNames.js';
import { loadSettings } from './settings.js';
import { initUptimeHistory } from './uptimeHistory.js';
import { getUpdateInfo, noteFrontendVersion, startUpdateCheck } from './updateCheck.js';
import { startUpstreamMonitor } from './upstreamMonitor.js';
import { getAvailableFonts, getEnabledLanguages } from './languages.js';

const authentication = await initializeAuthentication();
const app = express();
const PORT = process.env.PORT || 3001;
const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || 'http://caddy:2019';
const APP_VERSION = process.env.APP_VERSION || 'dev';

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.text({ type: 'text/plain' }));
app.use(diagnosticMiddleware);

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const elapsed = Date.now() - start;
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        logger[level](`${req.method} ${req.diagnosticPath}`, {
            status: res.statusCode,
            elapsed,
            ip: req.ip,
            requestId: req.diagnosticId,
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
    skip: req => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many login attempts, please try again later' },
});

app.use('/api', apiLimiter);
app.use('/api', createCrossSiteMiddleware(process.env.CADDY_UI_EXTERNAL_URL));
app.use('/api', createApiTokenMiddleware(authentication));
app.use('/api', createCsrfMiddleware(authentication.sessions));

// Auth routes are always public
app.use('/api/auth', authLimiter, authRouter);

// GET /api/version -- always public, non-sensitive. ?frontend=<version> lets
// the sidebar learn whether either image is behind (from the cached manifest)
app.get('/api/version', (req, res) => {
    const frontend = typeof req.query.frontend === 'string' ? req.query.frontend.slice(0, 64) : null;
    noteFrontendVersion(frontend);
    res.json({ version: APP_VERSION, update: getUpdateInfo({ backend: APP_VERSION, frontend }) });
});

// Instance, settings, custom-theme and notification routes require auth but not instance middleware
app.use('/api/instances', authMiddleware, instancesRouter);
app.use('/api/settings', authMiddleware, settingsRouter);
app.use('/api/custom-themes', authMiddleware, customThemesRouter);
// Notification settings cover every instance, so they work with none configured
app.use('/api/notifications', authMiddleware, notificationsRouter);

// GET /api/languages -- always public, non-sensitive
app.get('/api/languages', (req, res) => res.json({
    languages: getEnabledLanguages(),
    fonts: getAvailableFonts(),
}));
// caddy/ui application logs are global and must remain available even when
// there is no valid Caddy instance to attach to the request.
app.use('/api/logs/app', authMiddleware, appLogsRouter);

// GET /api/metrics/raw -- Prometheus scrape endpoint
// Public if CADDY_UI_PUBLIC_METRICS=true, otherwise requires auth
app.get('/api/metrics/raw', publicMetrics ? (req, res, next) => next() : authMiddleware, instanceMiddleware, rawMetrics);

// All other /api/* routes require a session, then a valid instance.
// Auth runs first so unauthenticated callers can't probe which instance ids exist.
app.use('/api', authMiddleware, instanceMiddleware);

app.use('/api/caddyfile', caddyfileRouter);
app.use('/api/routes', routesRouter);
app.use('/api/status', statusRouter);
app.use('/api/logs', logsRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/server-names', servernamesRouter);
app.use('/api/tls', tlsRouter);
app.use('/api/health', healthRouter);
app.use('/api/route-notes', routenotesRouter);

app.use((err, req, res, next) => {
    logger.error(`Unhandled error`, { requestId: req.diagnosticId, method: req.method, path: req.diagnosticPath || req.path, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message || 'Internal server error' });
});

await loadInstances();
await migrateLegacyHistory();
await loadServerNames(getInstances().map(i => i.id));
await loadSettings();
await loadMaintenance();
await loadCustomThemes();
await initUptimeHistory();
startUpstreamMonitor();
startRouteMonitor();
startUpdateCheck();

const server = app.listen(PORT, error => {
    // Express wraps this callback with `once`, which fires it for whichever
    // server event comes first — 'listening' or 'error'. Keep bind failures
    // fatal so startup cannot report success without a bound HTTP server.
    if (error) throw error;
    const port = server.address().port;
    logger.info(`Caddy UI backend running`, { port, version: APP_VERSION });
    logger.info(`Caddy admin API`, { url: CADDY_ADMIN_URL });
    logger.info(`Caddyfile path`, { path: process.env.CADDY_CONFIG_PATH || '/etc/caddy/Caddyfile' });
    logger.info(`Public metrics`, { enabled: publicMetrics });
    logger.info(`Enabled languages`, { languages: getEnabledLanguages() });
    logger.info(`Available UI fonts`, { languages: getAvailableFonts() });
    // Launchers using IPC can discover an OS-assigned port after it is bound.
    if (process.connected) process.send({ type: 'caddy-ui:listening', port });
    initMonitor({ apiTokens: () => authentication.apiTokenMetadata() });
    initCaddyfileTitles().then(() => cleanupOrphanedNotes());
});

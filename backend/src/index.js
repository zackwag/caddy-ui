import cors from 'cors';
import express from 'express';
import 'express-async-errors';

import { authMiddleware } from './middleware/auth.js';
import authRouter from './routes/auth.js';
import caddyfileRouter from './routes/caddyfile.js';
import healthRouter from './routes/health.js';
import logsRouter from './routes/logs.js';
import routenotesRouter from './routes/routenotes.js';
import routesRouter from './routes/routes.js';
import servernamesRouter from './routes/servernames.js';
import statusRouter from './routes/status.js';
import tlsRouter from './routes/tls.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.text({ type: 'text/plain' }));

// Auth routes are public
app.use('/api/auth', authRouter);

// All other /api/* routes require auth if enabled
app.use('/api', authMiddleware);

app.use('/api/caddyfile', caddyfileRouter);
app.use('/api/routes', routesRouter);
app.use('/api/status', statusRouter);
app.use('/api/logs', logsRouter);
app.use('/api/server-names', servernamesRouter);
app.use('/api/tls', tlsRouter);
app.use('/api/health', healthRouter);
app.use('/api/route-notes', routenotesRouter);

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`Caddy UI backend running on port ${PORT}`);
    console.log(`Caddy admin API: ${process.env.CADDY_ADMIN_URL || 'http://caddy:2019'}`);
    console.log(`Caddyfile path: ${process.env.CADDYFILE_PATH || '/etc/caddy/Caddyfile'}`);
});

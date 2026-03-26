import { Router } from 'express';
import { caddyGet, CADDY_ADMIN_URL } from '../caddy.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const config = await caddyGet('/config/');
    const apps = config?.apps || {};
    const httpApp = apps?.http || {};
    const servers = httpApp?.servers || {};

    const summary = {
      online: true,
      serverCount: Object.keys(servers).length,
      servers: Object.entries(servers).map(([name, srv]) => ({
        name,
        listen: srv.listen || [],
        routeCount: (srv.routes || []).length,
      })),
      tlsEnabled: !!apps?.tls,
      adminUrl: CADDY_ADMIN_URL,
    };

    res.json(summary);
  } catch (err) {
    res.json({ online: false, error: err.message });
  }
});

router.get('/config', async (req, res) => {
  const config = await caddyGet('/config/');
  res.json(config);
});

export default router;

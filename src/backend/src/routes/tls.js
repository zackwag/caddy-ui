import { Router } from 'express';
import { join, resolve, relative } from 'path';
import { caddyLocalRootCertificate } from '../caddy.js';
import { listCertificates } from '../certificates.js';
import { removeContainerPath } from '../containerFs.js';
import logger from '../logger.js';
import { AppError, asAppError } from '../AppError.js';

const router = Router();

async function readCertificates(instance) {
    try {
        return await listCertificates(instance);
    } catch (err) {
        throw asAppError(err, 'CERTIFICATE_READ_FAILED', { instanceId: instance.id });
    }
}

router.get('/', async (req, res) => {
    const certs = await readCertificates(req.instance);
    logger.info(`TLS certs listed`, { count: certs.length });
    res.json(certs);
});

// DELETE /api/tls/:domain[?issuer=<issuerDir>] -- without an issuer, the local
// CA's certificate is preferred
router.delete('/:domain', async (req, res) => {
    const { domain } = req.params;
    const { issuer } = req.query;
    logger.info(`TLS cert deletion requested`, { domain, issuer });

    // Certificate directory names: a host name, with Caddy's wildcard_ prefix
    const DOMAIN_RE = /^(?=.{1,253}$)(?:wildcard_\.)?(?!-)(?:[a-zA-Z0-9-]{1,63}\.)*[a-zA-Z0-9-]{1,63}$/;
    if (!DOMAIN_RE.test(domain)) {
        return res.status(400).json({ error: 'Invalid domain' });
    }

    const { containerName } = req.instance;
    const certsPath = join(req.instance.dataPath, 'certificates');
    const candidates = (await readCertificates(req.instance))
        .filter(cert => cert.domain === domain && cert.deletable && (!issuer || cert.issuerDir === issuer));
    const target = candidates.find(cert => cert.isInternal) ?? candidates[0];
    if (!target) {
        throw new AppError('CERTIFICATE_DELETE_DENIED', { context: { domain, issuer } });
    }

    if (!target.issuerDir || target.issuerDir.includes('..') || target.issuerDir.includes('/') || target.issuerDir.includes('\\')) {
        return res.status(400).json({ error: 'Invalid certificate target' });
    }

    const baseCertsDir = resolve(certsPath);
    const certDir = resolve(baseCertsDir, target.issuerDir, domain);
    const rel = relative(baseCertsDir, certDir);
    if (rel.startsWith('..') || rel.startsWith('/') || rel === '') {
        return res.status(400).json({ error: 'Invalid certificate path' });
    }

    try {
        await removeContainerPath(containerName, certDir);
    } catch (err) {
        throw asAppError(err, 'CERTIFICATE_DELETE_FAILED', { domain });
    }
    logger.info(`TLS cert deleted`, { domain, certDir });
    res.json({ ok: true, message: `Deleted cert for ${domain}` });
});

router.get('/ca', async (req, res) => {
    let pem;
    try {
        pem = await caddyLocalRootCertificate(req.instance.adminUrl);
    } catch (err) {
        throw asAppError(err, 'CERTIFICATE_CA_UNAVAILABLE', { instanceId: req.instance.id });
    }
    logger.info(`Root CA download served`);
    res.setHeader('Content-Disposition', 'attachment; filename="caddy-root-ca.crt"');
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.send(pem);
});

export default router;

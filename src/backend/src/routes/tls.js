import { Router } from 'express';
import { caddyLocalRootCertificate } from '../caddy.js';
import { deleteCertificate, listCertificates } from '../certificates.js';
import logger from '../logger.js';
import { asAppError } from '../AppError.js';

const router = Router();

router.get('/', async (req, res) => {
    let certs;
    try {
        certs = await listCertificates(req.instance);
    } catch (err) {
        throw asAppError(err, 'CERTIFICATE_READ_FAILED', { instanceId: req.instance.id });
    }
    logger.info(`TLS certs listed`, { count: certs.length });
    res.json(certs);
});

// DELETE /api/tls/:domain[?issuer=<issuerDir>] -- without an issuer, the local
// CA's certificate is preferred
router.delete('/:domain', async (req, res) => {
    const { domain } = req.params;
    const issuer = typeof req.query.issuer === 'string' ? req.query.issuer : undefined;
    logger.info(`TLS cert deletion requested`, { domain, issuer });
    const certDir = await deleteCertificate(req.instance, domain, issuer);
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

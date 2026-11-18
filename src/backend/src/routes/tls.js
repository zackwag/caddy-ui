import { Router } from 'express';
import { join, resolve, relative } from 'path';
import { listCertificates } from '../certificates.js';
import { removeContainerPath } from '../containerFs.js';
import logger from '../logger.js';
import { AppError, asAppError } from '../AppError.js';
import { sendAppError } from '../errorReporting.js';

const router = Router();

router.get('/', async (req, res) => {
    let certs;
    try {
        certs = await listCertificates(req.instance);
    } catch (err) {
        return sendAppError(res, asAppError(err, 'CERTIFICATE_READ_FAILED', { instanceId: req.instance.id }));
    }
    logger.info(`TLS certs listed`, { count: certs.length });
    res.json(certs);
});

router.delete('/:domain', async (req, res) => {
    const { domain } = req.params;
    logger.info(`TLS cert deletion requested`, { domain });

    // Certificate directory names: a host name, with Caddy's wildcard_ prefix
    const DOMAIN_RE = /^(?=.{1,253}$)(?:wildcard_\.)?(?!-)(?:[a-zA-Z0-9-]{1,63}\.)*[a-zA-Z0-9-]{1,63}$/;
    if (!DOMAIN_RE.test(domain)) {
        return res.status(400).json({ error: 'Invalid domain' });
    }

    const { containerName } = req.instance;
    const certsPath = join(req.instance.dataPath, 'certificates');
    let certs;
    try {
        certs = await listCertificates(req.instance);
    } catch (err) {
        return sendAppError(res, asAppError(err, 'CERTIFICATE_READ_FAILED', { instanceId: req.instance.id }));
    }
    const internalCert = certs.find(c => c.domain === domain && c.isInternal);
    const acmeCert = certs.find(c => c.domain === domain && !c.isInternal);

    const canDeleteInternal = internalCert && ['orphaned', 'superseded', 'expired'].includes(internalCert.status);
    const canDeleteAcme = acmeCert && acmeCert.status === 'orphaned';

    if (!canDeleteInternal && !canDeleteAcme) {
        logger.warn(`Refused to delete cert`, { domain });
        return sendAppError(res, new AppError('CERTIFICATE_DELETE_DENIED', { context: { domain } }));
    }

    const target = canDeleteInternal ? internalCert : acmeCert;
    if (!target?.issuerDir || target.issuerDir.includes('..') || target.issuerDir.includes('/') || target.issuerDir.includes('\\')) {
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
        logger.info(`TLS cert deleted`, { domain, certDir });
        res.json({ ok: true, message: `Deleted cert for ${domain}` });
    } catch (err) {
        logger.error(`Failed to delete cert`, { domain, error: err.message });
        sendAppError(res, asAppError(err, 'CERTIFICATE_DELETE_FAILED', { domain }));
    }
});

router.get('/ca', async (req, res) => {
    const adminUrl = req.instance.adminUrl;
    logger.info(`Root CA download requested`);
    try {
        const caRes = await fetch(`${adminUrl}/pki/ca/local`, {
            headers: { 'Origin': 'http://0.0.0.0:2019' },
        });
        if (!caRes.ok) throw new Error(`Caddy PKI API returned ${caRes.status}`);
        const data = await caRes.json();
        const pem = data.root_certificate;
        if (!pem) throw new Error('No root certificate in response');
        logger.info(`Root CA download served`);
        res.setHeader('Content-Disposition', 'attachment; filename="caddy-root-ca.crt"');
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        res.send(pem);
    } catch (err) {
        logger.error(`Root CA download failed`, { error: err.message });
        sendAppError(res, asAppError(err, 'CERTIFICATE_CA_UNAVAILABLE'));
    }
});

export default router;

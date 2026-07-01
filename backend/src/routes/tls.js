import { X509Certificate } from 'crypto';
import { Router } from 'express';
import { readdir, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { CADDY_ADMIN_URL, caddyGet } from '../caddy.js';
import logger from '../logger.js';

const router = Router();
const CADDY_DATA_PATH = process.env.CADDY_DATA_PATH || '/data/caddy/caddy';
const CERTS_PATH = join(CADDY_DATA_PATH, 'certificates');

async function parseCert(certPath) {
    try {
        const pem = await readFile(certPath, 'utf8');
        const cert = new X509Certificate(pem);
        return { validFrom: cert.validFrom, validTo: cert.validTo, subject: cert.subject, issuer: cert.issuer };
    } catch {
        return null;
    }
}

async function getManagedDomains() {
    try {
        const tls = await caddyGet('/config/apps/tls');
        const domains = new Set();
        for (const policy of tls?.automation?.policies || []) {
            for (const subject of policy.subjects || []) domains.add(subject);
        }
        return domains;
    } catch {
        return new Set();
    }
}

async function getCerts() {
    const results = [];
    const managedDomains = await getManagedDomains();

    let issuers;
    try {
        issuers = await readdir(CERTS_PATH);
    } catch {
        logger.warn(`Could not read certs path`, { path: CERTS_PATH });
        return [];
    }

    for (const issuer of issuers) {
        const issuerPath = join(CERTS_PATH, issuer);
        let domains;
        try {
            domains = await readdir(issuerPath);
        } catch {
            continue;
        }

        const isInternal = issuer === 'local';

        for (const domain of domains) {
            const certFile = join(issuerPath, domain, `${domain}.crt`);
            const info = await parseCert(certFile);
            if (!info) continue;

            const validTo = new Date(info.validTo);
            const now = new Date();
            const daysRemaining = Math.floor((validTo - now) / (1000 * 60 * 60 * 24));
            const isManaged = managedDomains.has(domain);

            let status;
            if (!isManaged) status = 'orphaned';
            else if (daysRemaining < 0) status = isInternal ? 'valid' : 'expired';
            else if (daysRemaining < 14 && !isInternal) status = 'expiring';
            else status = 'valid';

            results.push({ domain, issuer: isInternal ? 'internal' : 'acme', issuerDir: issuer, validFrom: info.validFrom, validTo: info.validTo, daysRemaining, isManaged, isInternal, status });
        }
    }

    // Mark internal certs as superseded when the same domain also has an ACME cert
    const acmeDomains = new Set(results.filter(c => !c.isInternal).map(c => c.domain));
    for (const cert of results) {
        if (cert.isInternal && acmeDomains.has(cert.domain)) {
            cert.status = 'superseded';
        }
    }

    return results.sort((a, b) => {
        const order = { orphaned: 0, superseded: 1, expired: 2, expiring: 3, valid: 4 };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return a.daysRemaining - b.daysRemaining;
    });
}

// GET /api/tls
router.get('/', async (req, res) => {
    const certs = await getCerts();
    logger.info(`TLS certs listed`, { count: certs.length });
    res.json(certs);
});

// DELETE /api/tls/:domain
router.delete('/:domain', async (req, res) => {
    const { domain } = req.params;
    logger.info(`TLS cert deletion requested`, { domain });

    if (domain.includes('..') || domain.includes('/')) {
        return res.status(400).json({ error: 'Invalid domain' });
    }

    const certs = await getCerts();
    const internalCert = certs.find(c => c.domain === domain && c.isInternal);
    const acmeCert = certs.find(c => c.domain === domain && !c.isInternal);

    const canDeleteInternal = internalCert && ['orphaned', 'superseded', 'expired'].includes(internalCert.status);
    const canDeleteAcme = acmeCert && acmeCert.status === 'orphaned';

    if (!canDeleteInternal && !canDeleteAcme) {
        logger.warn(`Refused to delete cert`, { domain });
        return res.status(403).json({ error: 'Cannot delete this cert — only orphaned, superseded, or expired internal certs can be removed' });
    }

    const target = canDeleteInternal ? internalCert : acmeCert;
    const certDir = join(CERTS_PATH, target.issuerDir, domain);

    try {
        await rm(certDir, { recursive: true, force: true });
        logger.info(`TLS cert deleted`, { domain, certDir });
        res.json({ ok: true, message: `Deleted cert for ${domain}` });
    } catch (err) {
        logger.error(`Failed to delete cert`, { domain, error: err.message });
        res.status(500).json({ error: `Failed to delete cert: ${err.message}` });
    }
});

// GET /api/tls/ca
router.get('/ca', async (req, res) => {
    logger.info(`Root CA download requested`);
    try {
        const caRes = await fetch(`${CADDY_ADMIN_URL}/pki/ca/local`, {
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
        res.status(404).json({ error: `Root CA cert not found: ${err.message}` });
    }
});

export default router;

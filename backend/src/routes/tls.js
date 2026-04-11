import { X509Certificate } from 'crypto';
import { Router } from 'express';
import { readdir, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { caddyGet } from '../caddy.js';

const router = Router();
const CADDY_DATA_PATH = process.env.CADDY_DATA_PATH || '/data/caddy/caddy';
const CERTS_PATH = join(CADDY_DATA_PATH, 'certificates');

async function parseCert(certPath) {
    try {
        const pem = await readFile(certPath, 'utf8');
        const cert = new X509Certificate(pem);
        return {
            validFrom: cert.validFrom,
            validTo: cert.validTo,
            subject: cert.subject,
            issuer: cert.issuer,
        };
    } catch {
        return null;
    }
}

async function getManagedDomains() {
    try {
        const tls = await caddyGet('/config/apps/tls');
        const domains = new Set();
        for (const policy of tls?.automation?.policies || []) {
            for (const subject of policy.subjects || []) {
                domains.add(subject);
            }
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
            if (!isManaged) {
                status = 'orphaned';
            } else if (daysRemaining < 0) {
                status = isInternal ? 'valid' : 'expired';
            } else if (daysRemaining < 14 && !isInternal) {
                status = 'expiring';
            } else {
                status = 'valid';
            }

            results.push({
                domain,
                issuer: isInternal ? 'internal' : 'acme',
                issuerDir: issuer,
                validFrom: info.validFrom,
                validTo: info.validTo,
                daysRemaining,
                isManaged,
                isInternal,
                status,
            });
        }
    }

    return results.sort((a, b) => {
        const order = { orphaned: 0, expired: 1, expiring: 2, valid: 3 };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return a.daysRemaining - b.daysRemaining;
    });
}

router.get('/', async (req, res) => {
    const certs = await getCerts();
    res.json(certs);
});

// DELETE /api/tls/:domain -- only allowed for orphaned certs
router.delete('/:domain', async (req, res) => {
    const { domain } = req.params;

    // Sanitize -- prevent directory traversal
    if (domain.includes('..') || domain.includes('/')) {
        return res.status(400).json({ error: 'Invalid domain' });
    }

    // Safety check -- verify it's actually orphaned before deleting
    const managedDomains = await getManagedDomains();
    if (managedDomains.has(domain)) {
        return res.status(403).json({ error: 'Cannot delete a cert for an actively managed domain' });
    }

    // Find the issuer directory by scanning the filesystem
    let certDir = null;
    try {
        const issuers = await readdir(CERTS_PATH);
        for (const issuer of issuers) {
            const candidate = join(CERTS_PATH, issuer, domain);
            try {
                await readdir(candidate);
                certDir = candidate;
                break;
            } catch { }
        }
    } catch (err) {
        return res.status(500).json({ error: `Failed to scan certs: ${err.message}` });
    }

    if (!certDir) {
        return res.status(404).json({ error: `Cert not found for domain: ${domain}` });
    }

    try {
        await rm(certDir, { recursive: true, force: true });
        res.json({ ok: true, message: `Deleted cert for ${domain}` });
    } catch (err) {
        res.status(500).json({ error: `Failed to delete cert: ${err.message}` });
    }
});

// GET /api/tls/ca -- download Caddy's root CA cert
router.get('/ca', async (req, res) => {
    try {
        const caPath = join(CERTS_PATH, '..', 'pki', 'authorities', 'local', 'root.crt');
        const cert = await readFile(caPath);
        res.setHeader('Content-Disposition', 'attachment; filename="caddy-root-ca.crt"');
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        res.send(cert);
    } catch (err) {
        res.status(404).json({ error: 'Root CA cert not found' });
    }
});

export default router;

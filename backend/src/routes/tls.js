import { X509Certificate } from 'crypto';
import { Router } from 'express';
import { join, resolve, relative } from 'path';
import { caddyGet } from '../caddy.js';
import { describeReadError, listContainerDir, readContainerDir, readContainerFile, removeContainerPath } from '../containerFs.js';
import logger from '../logger.js';

const router = Router();

// In local mode the certs path is a volume mount the user set up by hand, so
// say what to check.
const LOCAL_MODE_HINTS = {
    'not found': "Mount Caddy's data directory into the backend so this path exists, or fix the instance's data path",
    'permission denied': "Give caddy-ui's user read access to Caddy's data directory",
};

async function parseCert(containerName, certPath) {
    try {
        const pem = await readContainerFile(containerName, certPath);
        const cert = new X509Certificate(pem);
        return { validFrom: cert.validFrom, validTo: cert.validTo, subject: cert.subject, issuer: cert.issuer };
    } catch {
        return null;
    }
}

// Caddy only applies automatic HTTPS to servers that listen on something other
// than the HTTP port.
function servesHttps(server) {
    const listen = server.listen || [];
    return !listen.length || listen.some(addr => !/:80$/.test(addr));
}

// Names Caddy manages certificates for. Sites with their own TLS settings are
// listed as automation policy subjects, but most Caddyfile sites are managed
// implicitly by automatic HTTPS and only show up as route host matchers, so
// both are collected.
function collectManagedDomains(tlsApp, servers) {
    const domains = new Set();
    for (const policy of tlsApp?.automation?.policies || []) {
        for (const subject of policy.subjects || []) domains.add(subject.toLowerCase());
    }
    for (const server of Object.values(servers || {})) {
        const auto = server.automatic_https || {};
        if (auto.disable || auto.disable_certificates || !servesHttps(server)) continue;
        const skip = new Set([...(auto.skip || []), ...(auto.skip_certificates || [])].map(h => h.toLowerCase()));
        for (const route of server.routes || []) {
            for (const matcher of route.match || []) {
                for (const host of matcher.host || []) {
                    const name = host.toLowerCase();
                    if (name.includes('{') || skip.has(name)) continue;
                    domains.add(name);
                }
            }
        }
    }
    return domains;
}

// Caddy stores wildcard certs under "wildcard_.example.com" since "*" isn't
// safe in a directory name.
function isManagedDomain(certDir, managedDomains) {
    const name = certDir.toLowerCase().replace(/^wildcard_\./, '*.');
    return managedDomains.has(name);
}

// Returns null when the config can't be read, so certs aren't reported as
// orphaned (and offered for deletion) just because Caddy was unreachable.
async function getManagedDomains(adminUrl) {
    try {
        const [tlsApp, servers] = await Promise.all([
            caddyGet('/config/apps/tls', adminUrl),
            caddyGet('/config/apps/http/servers', adminUrl),
        ]);
        return collectManagedDomains(tlsApp, servers);
    } catch {
        return null;
    }
}

async function getCerts(containerName, certsPath, adminUrl) {
    const results = [];
    const managedDomains = await getManagedDomains(adminUrl);

    let issuers;
    try {
        issuers = await readContainerDir(containerName, certsPath);
    } catch (err) {
        const reason = describeReadError(err);
        const hint = containerName ? undefined : LOCAL_MODE_HINTS[reason];
        logger.warn(`Could not read certs path`, { path: certsPath, reason, ...(hint && { hint }) });
        return [];
    }

    for (const issuer of issuers) {
        const issuerPath = join(certsPath, issuer);
        const domains = await listContainerDir(containerName, issuerPath);
        if (!domains.length) continue;

        const isInternal = issuer === 'local';

        for (const domain of domains) {
            const certFile = join(issuerPath, domain, `${domain}.crt`);
            const info = await parseCert(containerName, certFile);
            if (!info) continue;

            const validTo = new Date(info.validTo);
            const now = new Date();
            const daysRemaining = Math.floor((validTo - now) / (1000 * 60 * 60 * 24));
            const isManaged = !managedDomains || isManagedDomain(domain, managedDomains);

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
    const certsPath = join(req.instance.dataPath, 'certificates');
    const certs = await getCerts(req.instance.containerName, certsPath, req.instance.adminUrl);
    logger.info(`TLS certs listed`, { count: certs.length });
    res.json(certs);
});

// DELETE /api/tls/:domain
router.delete('/:domain', async (req, res) => {
    const { domain } = req.params;
    logger.info(`TLS cert deletion requested`, { domain });

    const DOMAIN_RE = /^(?=.{1,253}$)(?!-)(?:[a-zA-Z0-9-]{1,63}\.)*[a-zA-Z0-9-]{1,63}$/;
    if (!DOMAIN_RE.test(domain) || domain.includes('..') || domain.includes('/') || domain.includes('\\')) {
        return res.status(400).json({ error: 'Invalid domain' });
    }

    const { containerName } = req.instance;
    const certsPath = join(req.instance.dataPath, 'certificates');
    const certs = await getCerts(containerName, certsPath, req.instance.adminUrl);
    const internalCert = certs.find(c => c.domain === domain && c.isInternal);
    const acmeCert = certs.find(c => c.domain === domain && !c.isInternal);

    const canDeleteInternal = internalCert && ['orphaned', 'superseded', 'expired'].includes(internalCert.status);
    const canDeleteAcme = acmeCert && acmeCert.status === 'orphaned';

    if (!canDeleteInternal && !canDeleteAcme) {
        logger.warn(`Refused to delete cert`, { domain });
        return res.status(403).json({ error: 'Cannot delete this cert — only orphaned, superseded, or expired internal certs can be removed' });
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
        res.status(500).json({ error: `Failed to delete cert: ${err.message}` });
    }
});

// GET /api/tls/ca
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
        res.status(404).json({ error: `Root CA cert not found: ${err.message}` });
    }
});

export default router;
export { collectManagedDomains, isManagedDomain };

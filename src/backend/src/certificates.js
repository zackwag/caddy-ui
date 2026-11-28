import { X509Certificate } from 'crypto';
import { join, relative, resolve } from 'path';
import { AppError, asAppError } from './AppError.js';
import { caddyGet } from './caddy.js';
import { containerPathExists, describeReadError, listContainerDir, readContainerDir, readContainerFile, removeContainerPath } from './containerFs.js';
import logger from './logger.js';
import { getServers } from './observations.js';

// Days before expiry an ACME certificate counts as expiring.
const EXPIRING_DAYS = 14;
const DAY_MS = 86_400_000;
// Certificates Caddy no longer uses, so deleting them breaks nothing.
const DELETABLE_STATUSES = new Set(['orphaned', 'superseded']);

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
export function collectManagedDomains(tlsApp, servers) {
    const domains = new Set();
    for (const policy of tlsApp?.automation?.policies || []) {
        for (const subject of policy.subjects || []) {
            domains.add(subject.toLowerCase());
        }
    }
    for (const server of Object.values(servers || {})) {
        const auto = server.automatic_https || {};
        if (auto.disable || auto.disable_certificates || !servesHttps(server)) {
            continue;
        }
        const skip = new Set([...(auto.skip || []), ...(auto.skip_certificates || [])].map(h => h.toLowerCase()));
        for (const route of server.routes || []) {
            for (const matcher of route.match || []) {
                for (const host of matcher.host || []) {
                    const name = host.toLowerCase();
                    if (name.includes('{') || skip.has(name)) {
                        continue;
                    }
                    domains.add(name);
                }
            }
        }
    }
    return domains;
}

// Caddy stores wildcard certs under "wildcard_.example.com" since "*" isn't
// safe in a directory name.
export function certificateName(certDir) {
    return certDir.toLowerCase().replace(/^wildcard_\./, '*.');
}

export function isManagedDomain(certDir, managedDomains) {
    return managedDomains.has(certificateName(certDir));
}

// Returns null when the config can't be read, so certs aren't reported as
// orphaned (and offered for deletion) just because Caddy was unreachable.
async function getManagedDomains(adminUrl) {
    try {
        const [tlsApp, servers] = await Promise.all([
            caddyGet('/config/apps/tls', adminUrl),
            getServers(adminUrl),
        ]);
        return collectManagedDomains(tlsApp, servers);
    } catch {
        return null;
    }
}

// Caddy creates its data directory, and the certificates directory in it,
// only once it stores something, so an HTTP-only setup may never have either:
// a missing path is an empty list. Storage that exists but can't be read
// throws CERTIFICATE_READ_FAILED, so a permissions or container problem never
// looks like "no certificates". `quiet` leaves logging read problems to the
// caller, for background checks that log once per outage.
export async function listCertificates({ containerName, dataPath, adminUrl }, { quiet = false } = {}) {
    const results = [];
    const certsPath = join(dataPath, 'certificates');
    const managedDomains = await getManagedDomains(adminUrl);

    let issuers;
    try {
        issuers = await readContainerDir(containerName, certsPath);
    } catch (err) {
        const reason = describeReadError(err);
        const hint = containerName ? undefined : LOCAL_MODE_HINTS[reason];
        if (reason === 'not found') {
            // In local mode a missing data path can also be a volume that was never mounted
            if (hint && !quiet && !await containerPathExists(containerName, dataPath)) {
                logger.warn(`Certs path not found`, { path: certsPath, hint });
            }
            return [];
        }
        if (!quiet) {
            logger.warn(`Could not read certs path`, { path: certsPath, reason, ...(hint && { hint }) });
        }
        throw new AppError('CERTIFICATE_READ_FAILED', { cause: err, context: { path: certsPath, reason } });
    }

    for (const issuer of issuers) {
        const issuerPath = join(certsPath, issuer);
        const domains = await listContainerDir(containerName, issuerPath);
        if (!domains.length) {
            continue;
        }

        const isInternal = issuer === 'local';

        for (const domain of domains) {
            const certFile = join(issuerPath, domain, `${domain}.crt`);
            const info = await parseCert(containerName, certFile);
            if (!info) {
                continue;
            }

            const validTo = new Date(info.validTo);
            const now = new Date();
            const daysRemaining = Math.floor((validTo - now) / DAY_MS);
            // null when Caddy's config couldn't be read: unknown, so never orphaned
            const isManaged = managedDomains ? isManagedDomain(domain, managedDomains) : null;

            let status;
            if (isManaged === false) {
                status = 'orphaned';
            } else if (daysRemaining < 0) {
                status = isInternal ? 'valid' : 'expired';
            } else if (daysRemaining < EXPIRING_DAYS && !isInternal) {
                status = 'expiring';
            } else {
                status = 'valid';
            }

            results.push({ domain, issuer: isInternal ? 'internal' : 'acme', issuerDir: issuer, validFrom: info.validFrom, validTo: info.validTo, daysRemaining, isManaged, isInternal, status });
        }
    }

    const acmeDomains = new Set(results.filter(c => !c.isInternal).map(c => c.domain));
    for (const cert of results) {
        if (cert.isInternal && acmeDomains.has(cert.domain)) {
            cert.status = 'superseded';
        }
    }

    for (const cert of results) {
        cert.deletable = DELETABLE_STATUSES.has(cert.status);
    }

    return results.sort((a, b) => {
        const order = { orphaned: 0, superseded: 1, expired: 2, expiring: 3, valid: 4 };
        if (order[a.status] !== order[b.status]) {
            return order[a.status] - order[b.status];
        }
        return a.daysRemaining - b.daysRemaining;
    });
}


// Certificate directory names: a host name, with Caddy's wildcard_ prefix
const CERTIFICATE_DOMAIN = /^(?=.{1,253}$)(?:wildcard_\.)?(?!-)(?:[a-zA-Z0-9-]{1,63}\.)*[a-zA-Z0-9-]{1,63}$/;

// Deletes a certificate Caddy no longer uses (see DELETABLE_STATUSES), from
// the issuer directory named, or else preferring the local CA's. Resolves to
// the directory removed. Throws CERTIFICATE_DELETE_DENIED when there is no
// such deletable certificate.
export async function deleteCertificate(instance, domain, issuer) {
    if (typeof domain !== 'string' || !CERTIFICATE_DOMAIN.test(domain)) {
        throw new AppError('VALIDATION_FAILED', { context: { field: 'domain' } });
    }
    let certs;
    try {
        certs = await listCertificates(instance);
    } catch (err) {
        throw asAppError(err, 'CERTIFICATE_READ_FAILED', { instanceId: instance.id });
    }
    const candidates = certs.filter(cert => cert.domain === domain && cert.deletable && (!issuer || cert.issuerDir === issuer));
    const target = candidates.find(cert => cert.isInternal) ?? candidates[0];
    if (!target) {
        throw new AppError('CERTIFICATE_DELETE_DENIED', { context: { domain, issuer } });
    }

    if (!target.issuerDir || target.issuerDir.includes('..') || target.issuerDir.includes('/') || target.issuerDir.includes('\\')) {
        throw new AppError('VALIDATION_FAILED', { context: { field: 'issuer' } });
    }
    const baseCertsDir = resolve(join(instance.dataPath, 'certificates'));
    const certDir = resolve(baseCertsDir, target.issuerDir, domain);
    const rel = relative(baseCertsDir, certDir);
    if (rel.startsWith('..') || rel.startsWith('/') || rel === '') {
        throw new AppError('VALIDATION_FAILED', { context: { field: 'domain' } });
    }

    try {
        await removeContainerPath(instance.containerName, certDir);
    } catch (err) {
        throw asAppError(err, 'CERTIFICATE_DELETE_FAILED', { domain });
    }
    return certDir;
}

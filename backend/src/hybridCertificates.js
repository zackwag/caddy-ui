import { readFile, readdir } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { createHash, X509Certificate } from 'node:crypto';
import { caddyGet } from './caddy.js';
import { certificateIssuer } from './loadedCertificates.js';

const uploadedId = /^[0-9a-f-]{36}$/;
export const validCertificateId = id => uploadedId.test(id) || /^(file|managed)-[0-9a-f]{64}$/.test(id);
const identity = (prefix, value) => `${prefix}-${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
// Caddy expands placeholders even inside quoted arguments. Never render them.
// eslint-disable-next-line no-control-regex -- Caddyfile tokens must reject control-character injection.
export const safeCertificatePath = path => typeof path === 'string' && isAbsolute(path) && !/[\x00-\x1f\x7f"\\{}$#]/.test(path);
export function fileReference(certificatePath, keyPath) {
    if (!safeCertificatePath(certificatePath) || !safeCertificatePath(keyPath)) return null;
    return { source: 'configured', certificatePath, keyPath };
}

export function renderCertificate(site) {
    if (!site.certificate) return '';
    const ref = site.certificateRef;
    if (uploadedId.test(site.certificate)) return `tls /hybrid/certs/${site.certificate}/cert.pem /hybrid/certs/${site.certificate}/key.pem`;
    if (ref?.source === 'configured' && fileReference(ref.certificatePath, ref.keyPath)
        && site.certificate === identity('file', [ref.certificatePath, ref.keyPath])) {
        return `tls ${JSON.stringify(ref.certificatePath)} ${JSON.stringify(ref.keyPath)}`;
    }
    // Do not load ACME storage as static files: doing so disables renewal.
    if (/^managed-[0-9a-f]{64}$/.test(site.certificate) && ref?.source === 'acme') return '';
    if (/^managed-[0-9a-f]{64}$/.test(site.certificate) && ref?.source === 'internal') return 'tls internal';
    throw new Error('Certificate reference is unavailable; choose a certificate again');
}

export function publicCertificate(entry) {
    const { id, source, names, dnsNames, subject, issuer, validFrom, validTo, daysRemaining, reason } = entry;
    return { id, source, names, dnsNames, subject, issuer, validFrom, validTo, daysRemaining, reason, selectable: !reason };
}

export function selectCertificate(entries, id, domain, now = Date.now()) {
    const entry = entries.find(item => item.id === id);
    if (!entry?.cert) throw new Error('Certificate is unavailable; check the public certificate mount and refresh');
    if (entry.reason || Date.parse(entry.cert.validFrom) > now || Date.parse(entry.cert.validTo) <= now) throw new Error('Certificate is expired, not yet valid or unavailable');
    if (!entry.cert.checkHost(domain)) throw new Error('Certificate does not cover this hostname');
    return entry.reference;
}

// Only public certificate files are read. Configured private keys stay in Caddy.
// Paths come from Caddy or server-written state, never from the request body.
export async function discoverCertificates({ savedSites = [], root = '/hybrid', dataPath = process.env.CADDY_DATA_PATH || '/data/caddy', adminUrl = process.env.CADDY_ADMIN_URL, read = readFile, list = readdir, get = caddyGet, now = Date.now() } = {}) {
    const entries = new Map();
    const knownPaths = new Set();
    const warnings = new Set();
    async function directories(path, source) {
        try { return await list(path); } catch (err) { if (err.code !== 'ENOENT' && source) warnings.add(source); return []; }
    }
    async function add(id, source, path, reference) {
        if (entries.has(id) || knownPaths.has(path)) return;
        knownPaths.add(path);
        let entry = { id, source, reference, names: path, dnsNames: [], reason: 'unavailable' };
        try {
            const cert = new X509Certificate(await read(path));
            const dnsNames = [...(cert.subjectAltName || '').matchAll(/(?:^|,\s*)DNS:([^,]+)/g)].map(match => match[1].toLowerCase());
            // Certificates without SAN may still use their CN for host matching.
            if (!cert.subjectAltName) { const cn = cert.subject.match(/(?:^|\n)CN=([^\n]+)/)?.[1]; if (cn) dnsNames.push(cn.toLowerCase()); }
            const reason = Date.parse(cert.validFrom) > now ? 'not-yet-valid' : Date.parse(cert.validTo) <= now ? 'expired' : null;
            entry = { ...entry, cert, names: dnsNames.join(', ') || cert.subject, dnsNames, subject: cert.subject, issuer: certificateIssuer(cert.issuer), validFrom: cert.validFrom, validTo: cert.validTo, daysRemaining: Math.floor((Date.parse(cert.validTo) - now) / 86400000), reason };
        } catch { /* Leave the unreadable certificate visible but unselectable. */ }
        entries.set(id, entry);
    }
    for (const id of await directories(join(root, 'certs'), 'imported')) {
        if (uploadedId.test(id)) await add(id, 'imported', join(root, 'certs', id, 'cert.pem'), null);
    }
    let configured = [];
    try {
        const files = await get('/config/apps/tls/certificates/load_files', adminUrl);
        if (files != null && !Array.isArray(files)) throw new Error('Invalid certificate loader');
        configured = files || [];
    } catch (err) { if (!/Caddy API error: 404\b/.test(err.message)) warnings.add('configured'); }
    // Keep saved references usable during restarts or after the original label
    // site disappears. The UI cannot supply or change these references.
    for (const site of savedSites) {
        const ref = site.certificateRef;
        if (ref?.source === 'configured' && site.certificate === identity('file', [ref.certificatePath, ref.keyPath])) configured.push({ certificate: ref.certificatePath, key: ref.keyPath });
    }
    for (const file of configured) {
        const ref = fileReference(file.certificate, file.key);
        if (!ref) { warnings.add('configured'); continue; }
        await add(identity('file', [file.certificate, file.key]), 'configured', file.certificate, ref);
    }
    const storage = join(dataPath, 'certificates');
    // This is an inventory, not proof of the certificate currently served.
    for (const issuer of await directories(storage, 'managed')) {
        if (!/^[a-zA-Z0-9._-]+$/.test(issuer)) continue;
        for (const domain of await directories(join(storage, issuer), 'managed')) {
            if (!/^[a-zA-Z0-9._-]+$/.test(domain)) continue;
            const source = issuer === 'local' ? 'internal' : 'acme';
            await add(identity('managed', [issuer, domain]), source, join(storage, issuer, domain, `${domain}.crt`), { source });
        }
    }
    return { entries: [...entries.values()], warnings: [...warnings] };
}

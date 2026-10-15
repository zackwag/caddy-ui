import { X509Certificate } from 'node:crypto';
import { caddyGet } from './caddy.js';
import { readContainerFile } from './containerFs.js';

export function certificateIssuer(issuer) {
    if (/cloudflare/i.test(issuer) && /origin/i.test(issuer)) return 'Cloudflare Origin CA';
    return issuer.match(/(?:^|\n)CN=([^\n]+)/)?.[1]
        || issuer.match(/(?:^|\n)O=([^\n]+)/)?.[1]
        || issuer;
}

// Inspect files referenced by Caddy's config. This does not prove which
// certificate a running TLS listener (or a public CDN edge) serves.
export async function loadedCertificates(instance) {
    let files;
    try {
        files = await caddyGet('/config/apps/tls/certificates/load_files', instance.adminUrl);
    } catch (err) {
        // A missing loader is normal for installations using only automatic HTTPS.
        if (/Caddy API error: 404\b/.test(err.message)) return [];
        throw err;
    }
    if (files == null) return [];
    if (!Array.isArray(files)) throw new Error('Invalid certificate loader configuration');
    const result = [];
    for (const path of new Set((files || []).map(f => f.certificate).filter(Boolean))) {
        try {
            const cert = new X509Certificate(await readContainerFile(instance.containerName, path));
            const daysRemaining = Math.floor((Date.parse(cert.validTo) - Date.now()) / 86400000);
            result.push({ domain: cert.subjectAltName?.replace(/DNS:/g, '') || cert.subject, issuer: 'imported', issuerName: certificateIssuer(cert.issuer), source: 'configured-file', deletable: false, path, validFrom: cert.validFrom, validTo: cert.validTo, daysRemaining, isManaged: false, isInternal: false, status: daysRemaining < 0 ? 'expired' : daysRemaining < 14 ? 'expiring' : 'valid' });
        } catch {
            // Keep an unreadable configured file visible instead of implying a
            // complete inventory. Neither certificate contents nor keys are sent.
            result.push({ domain: path, issuer: 'imported', source: 'configured-file', deletable: false, path, validFrom: null, validTo: null, daysRemaining: null, isManaged: false, isInternal: false, status: 'unavailable' });
        }
    }
    return result;
}

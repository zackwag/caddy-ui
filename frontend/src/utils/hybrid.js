/* eslint-disable i18next/no-literal-string -- Headless protocol projection and validation return identifiers and translation keys, never display copy. */

export function filterHybridSites(data, search = '', source = 'all') {
    if (!data) return [];
    const query = search.trim().toLowerCase();
    return [
        ...data.sites.map(site => ({ ...site, source: 'manual' })),
        ...data.labels.map(domain => ({ domain, upstream: '', source: 'labels', status: 'labels' })),
    ].filter(site => (source === 'all' || site.source === source)
        && `${site.domain} ${site.upstream}`.toLowerCase().includes(query))
        .sort((a, b) => a.domain.localeCompare(b.domain));
}

export function validateHybridSite(site, labels) {
    if (site.domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(site.domain)) return 'hybrid.invalidDomain';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*:[0-9]{1,5}$/.test(site.upstream)) return 'hybrid.invalidUpstream';
    const port = Number(site.upstream.split(':').at(-1));
    if (port < 1 || port > 65535) return 'hybrid.invalidUpstream';
    if (labels.some(host => host === site.domain || (host.startsWith('*.') && site.domain.endsWith(host.slice(1)) && site.domain.split('.').length === host.split('.').length))) return 'hybrid.conflictHelp';
    return '';
}

export function certificateProblem(cert, domain, now = Date.now()) {
    if (!cert || cert.reason === 'unavailable') return 'hybrid.certificateUnavailable';
    if (cert.reason === 'expired' || (cert.validTo && Date.parse(cert.validTo) <= now) || cert.daysRemaining < 0) return 'hybrid.certificateExpired';
    if (cert.reason === 'not-yet-valid' || (cert.validFrom && Date.parse(cert.validFrom) > now)) return 'hybrid.certificateNotYetValid';
    const host = domain.trim().toLowerCase();
    // Server-side X.509 validation is authoritative. Only preflight known SANs.
    if (host && cert.dnsNames && !cert.dnsNames.some(name => name === host || (name.startsWith('*.') && host.endsWith(name.slice(1)) && host.split('.').length === name.split('.').length))) return 'hybrid.certificateMismatch';
    return '';
}

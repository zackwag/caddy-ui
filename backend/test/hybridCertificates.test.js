import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { discoverCertificates, publicCertificate, renderCertificate, selectCertificate, safeCertificatePath } from '../src/hybridCertificates.js';
import { validateSite } from '../src/hybrid.js';

let dir, pem, cert;
const uuid = '11111111-1111-1111-1111-111111111111';
beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'hybrid-catalog-test-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=example.test', '-addext', 'subjectAltName=DNS:*.example.test,DNS:example.test', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
    pem = readFileSync(join(dir, 'cert.pem'));
    cert = new X509Certificate(pem);
});
afterAll(() => { if (dir) rmSync(dir, { recursive: true }); });

function options(overrides = {}) {
    return {
        list: async () => [],
        get: async () => [{ certificate: '/certs/origin.pem', key: '/certs/origin.key' }],
        read: async path => { expect(path).not.toMatch(/\.key$/); return pem; },
        ...overrides,
    };
}

describe('hybrid certificate selection', () => {
    it('discovers a configured wildcard using only the public file and keeps a stable opaque ID', async () => {
        const catalog = await discoverCertificates(options());
        expect(catalog.warnings).toEqual([]);
        const entry = catalog.entries[0];
        expect(entry).toMatchObject({ source: 'configured', dnsNames: ['*.example.test', 'example.test'], reason: null });
        expect(entry.id).toMatch(/^file-[0-9a-f]{64}$/);
        const reference = selectCertificate(catalog.entries, entry.id, 'app.example.test');
        expect(renderCertificate({ certificate: entry.id, certificateRef: reference })).toBe('tls "/certs/origin.pem" "/certs/origin.key"');
        expect(selectCertificate(catalog.entries, entry.id, 'example.test')).toEqual(reference);
        expect(() => selectCertificate(catalog.entries, entry.id, 'a.b.example.test')).toThrow('does not cover');
        expect(() => selectCertificate(catalog.entries, entry.id, 'other.test')).toThrow('does not cover');
        const json = JSON.stringify(publicCertificate(entry));
        expect(json).not.toMatch(/origin\.key|BEGIN CERTIFICATE|reference|privateKey/);
        const next = await discoverCertificates(options({ get: async () => [] , savedSites: [{ certificate: entry.id, certificateRef: reference }] }));
        expect(next.entries[0].id).toBe(entry.id);
    });

    it('deduplicates uploaded and configured paths, preserving existing upload IDs', async () => {
        const path = `/hybrid/certs/${uuid}/cert.pem`;
        const { entries } = await discoverCertificates(options({ list: async path => path === '/hybrid/certs' ? [uuid] : [], get: async () => [{ certificate: path, key: `/hybrid/certs/${uuid}/key.pem` }] }));
        expect(entries).toHaveLength(1);
        expect(entries[0].id).toBe(uuid);
        expect(renderCertificate({ certificate: uuid })).toContain(`/hybrid/certs/${uuid}/key.pem`);
    });

    it('rejects certificates at exact expiry and before validity begins', async () => {
        for (const [now, reason] of [[Date.parse(cert.validTo), 'expired'], [Date.parse(cert.validFrom) - 1, 'not-yet-valid']]) {
            const { entries } = await discoverCertificates(options({ now }));
            expect(publicCertificate(entries[0])).toMatchObject({ selectable: false, reason });
            expect(() => selectCertificate(entries, entries[0].id, 'app.example.test', now)).toThrow();
        }
        const { entries } = await discoverCertificates(options({ now: Date.parse(cert.validTo) - 1 }));
        expect(entries[0].daysRemaining).toBe(0);
        expect(publicCertificate(entries[0]).selectable).toBe(true);
    });

    it('keeps unreadable files visible and refuses saving them', async () => {
        const { entries } = await discoverCertificates(options({ read: async () => { throw new Error('EACCES'); } }));
        expect(publicCertificate(entries[0])).toMatchObject({ selectable: false, reason: 'unavailable' });
        expect(() => selectCertificate(entries, entries[0].id, 'app.example.test')).toThrow('unavailable');
        expect(() => selectCertificate(entries, 'file-' + 'a'.repeat(64), 'app.example.test')).toThrow('unavailable');
    });

    it('reports discovery failures instead of implying an empty complete inventory', async () => {
        const { warnings } = await discoverCertificates(options({ get: async () => { throw new Error('connection refused'); } }));
        expect(warnings).toContain('configured');
        expect((await discoverCertificates(options({ get: async () => { throw new Error('Caddy API error: 404'); } }))).warnings).toEqual([]);
    });

    it.each(['/certs/{env.SECRET}', '/certs/$KEY', '/certs/key\nrespond hacked', 'relative.pem', '/certs/"bad'])('rejects unsafe configured path %s', path => {
        expect(safeCertificatePath(path)).toBe(false);
    });

    it('ignores caller-provided paths and forged persisted references', async () => {
        const { entries } = await discoverCertificates(options());
        const site = validateSite({ domain: 'app.example.test', upstream: 'web:80', certificate: entries[0].id, certificateRef: { source: 'configured', certificatePath: '/etc/passwd', keyPath: '/etc/shadow' } });
        expect(site).not.toHaveProperty('certificateRef');
        expect(() => renderCertificate({ ...site, certificateRef: { source: 'configured', certificatePath: '/etc/passwd', keyPath: '/etc/shadow' } })).toThrow();
    });

    it('preserves automatic renewal instead of pinning Caddy storage files', async () => {
        const { entries } = await discoverCertificates(options({ get: async () => [], list: async path => path === '/data/caddy/certificates' ? ['acme.example-directory', 'local'] : path.endsWith('certs') ? [] : ['wildcard_.example.test'] }));
        expect(entries.map(e => e.source)).toEqual(['acme', 'internal']);
        for (const entry of entries) {
            const reference = selectCertificate(entries, entry.id, 'app.example.test');
            const rendered = renderCertificate({ certificate: entry.id, certificateRef: reference });
            expect(rendered).toBe(entry.source === 'acme' ? '' : 'tls internal');
            expect(rendered).not.toContain('/data/');
        }
    });
});

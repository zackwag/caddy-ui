import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { certificateIssuer, loadedCertificates } from '../src/loadedCertificates.js';

const { caddyGet, readContainerFile } = vi.hoisted(() => ({ caddyGet: vi.fn(), readContainerFile: vi.fn() }));
vi.mock('../src/caddy.js', () => ({ caddyGet }));
vi.mock('../src/containerFs.js', () => ({ readContainerFile }));

const instance = { adminUrl: 'http://caddy:2019', containerName: 'caddy' };
const pem = rootCertificates[0];
const cert = new X509Certificate(pem);

beforeEach(() => {
    caddyGet.mockReset().mockResolvedValue([{ certificate: '/certs/origin.pem', key: '/certs/private.key' }]);
    readContainerFile.mockReset().mockResolvedValue(pem);
});
afterEach(() => vi.useRealTimers());

describe('configured certificate inventory', () => {
    it('reads only certificate files and reports their origin and actual issuer', async () => {
        const [result] = await loadedCertificates(instance);
        expect(readContainerFile).toHaveBeenCalledExactlyOnceWith('caddy', '/certs/origin.pem');
        expect(result).toMatchObject({ source: 'configured-file', issuer: 'imported', issuerName: certificateIssuer(cert.issuer), deletable: false, isManaged: false, validTo: cert.validTo });
        expect(JSON.stringify(result)).not.toContain('private.key');
        expect(result).not.toHaveProperty('active');
    });

    it('deduplicates shared file references', async () => {
        caddyGet.mockResolvedValue([{ certificate: '/certs/origin.pem' }, { certificate: '/certs/origin.pem' }]);
        expect(await loadedCertificates(instance)).toHaveLength(1);
        expect(readContainerFile).toHaveBeenCalledOnce();
    });

    it('identifies the Cloudflare Origin issuer from X.509 identity', () => {
        expect(certificateIssuer('C=US\nO=CloudFlare, Inc.\nOU=CloudFlare Origin SSL Certificate Authority')).toBe('Cloudflare Origin CA');
        expect(certificateIssuer('O=Example CA\nCN=Example Issuer')).toBe('Example Issuer');
        expect(certificateIssuer('O=Example CA')).toBe('Example CA');
    });

    it('keeps missing or invalid configured files visible without claiming validity', async () => {
        readContainerFile.mockRejectedValue(new Error('ENOENT'));
        expect(await loadedCertificates(instance)).toEqual([expect.objectContaining({ source: 'configured-file', status: 'unavailable', daysRemaining: null, validTo: null, deletable: false })]);
        readContainerFile.mockResolvedValue('invalid PEM');
        expect((await loadedCertificates(instance))[0].status).toBe('unavailable');
    });

    it('keeps expired imported files read-only', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(Date.parse(cert.validTo) + 86400000));
        expect((await loadedCertificates(instance))[0]).toMatchObject({ status: 'expired', deletable: false });
    });

    it('treats absent loaders as empty but does not hide admin connection failures', async () => {
        caddyGet.mockRejectedValue(new Error('Caddy API error: 404 not found'));
        expect(await loadedCertificates(instance)).toEqual([]);
        caddyGet.mockRejectedValue(new Error('connection refused'));
        await expect(loadedCertificates(instance)).rejects.toThrow('connection refused');
    });
});

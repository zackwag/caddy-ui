import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Caddy routes no hosts, so every stored certificate is orphaned and deletable
vi.mock('../src/caddy.js', async importOriginal => ({ ...await importOriginal(), caddyGet: vi.fn(async () => null) }));
vi.mock('../src/observations.js', () => ({ getServers: vi.fn(async () => ({})) }));
const { deleteCertificate } = await import('../src/certificates.js');

const DOMAIN = 'app.example.com';
let dataPath, instance;
const certDir = issuer => join(dataPath, 'certificates', issuer, DOMAIN);
const store = issuer => {
    mkdirSync(certDir(issuer), { recursive: true });
    cpSync(new URL(`./fixtures/${DOMAIN}.crt`, import.meta.url), join(certDir(issuer), `${DOMAIN}.crt`));
};

beforeEach(() => {
    dataPath = mkdtempSync(join(tmpdir(), 'caddy-ui-certs-'));
    instance = { id: 'alpha', adminUrl: 'http://127.0.0.1:1', dataPath, containerName: '' };
});
afterEach(() => rmSync(dataPath, { recursive: true, force: true }));

describe('deleteCertificate', () => {
    it('prefers the local CA when no issuer is named', async () => {
        store('local');
        store('acme-v02.api.letsencrypt.org-directory');
        expect(await deleteCertificate(instance, DOMAIN)).toBe(certDir('local'));
        expect(existsSync(certDir('local'))).toBe(false);
        expect(existsSync(certDir('acme-v02.api.letsencrypt.org-directory'))).toBe(true);
    });

    it('deletes from the issuer named', async () => {
        store('local');
        store('acme-v02.api.letsencrypt.org-directory');
        await deleteCertificate(instance, DOMAIN, 'acme-v02.api.letsencrypt.org-directory');
        expect(existsSync(certDir('local'))).toBe(true);
        expect(existsSync(certDir('acme-v02.api.letsencrypt.org-directory'))).toBe(false);
    });

    it.each(['../app.example.com', 'app.example.com/..', '-app.example.com', ''])('rejects the domain %j before reading anything', async domain => {
        await expect(deleteCertificate(instance, domain)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', context: { field: 'domain' } });
    });

    it('denies a certificate that is not stored', async () => {
        store('local');
        await expect(deleteCertificate(instance, 'other.example.com')).rejects.toMatchObject({ code: 'CERTIFICATE_DELETE_DENIED' });
        await expect(deleteCertificate(instance, DOMAIN, 'unknown-issuer')).rejects.toMatchObject({ code: 'CERTIFICATE_DELETE_DENIED' });
        expect(existsSync(certDir('local'))).toBe(true);
    });
});

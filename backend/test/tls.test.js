import { describe, expect, it } from 'vitest';
import { collectManagedDomains, isManagedDomain } from '../src/routes/tls.js';

const site = (...hosts) => ({ match: [{ host: hosts }], handle: [] });

describe('collectManagedDomains', () => {
    it('includes hosts managed implicitly by automatic HTTPS', () => {
        // What `caddy adapt` produces for plain sites: no apps.tls at all
        const servers = { srv0: { listen: [':443'], routes: [site('a.example.com'), site('B.example.com')] } };
        expect(collectManagedDomains(null, servers)).toEqual(new Set(['a.example.com', 'b.example.com']));
    });

    it('includes hosts when local_certs adds a policy without subjects', () => {
        const tlsApp = { automation: { policies: [{ issuers: [{ module: 'internal' }] }] } };
        const servers = { srv0: { listen: [':443'], routes: [site('app.internal')] } };
        expect(collectManagedDomains(tlsApp, servers)).toEqual(new Set(['app.internal']));
    });

    it('includes automation policy subjects', () => {
        const tlsApp = { automation: { policies: [{ subjects: ['*.example.com'] }] } };
        expect(collectManagedDomains(tlsApp, {})).toEqual(new Set(['*.example.com']));
    });

    it('skips servers without automatic HTTPS', () => {
        const servers = {
            disabled: { listen: [':443'], automatic_https: { disable: true }, routes: [site('a.example.com')] },
            noCerts: { listen: [':443'], automatic_https: { disable_certificates: true }, routes: [site('b.example.com')] },
            httpOnly: { listen: [':80'], routes: [site('c.example.com')] },
        };
        expect(collectManagedDomains(null, servers).size).toBe(0);
    });

    it('skips excluded hosts and placeholders', () => {
        const servers = {
            srv0: {
                listen: [':443'],
                automatic_https: { skip: ['a.example.com'], skip_certificates: ['b.example.com'] },
                routes: [site('a.example.com', 'b.example.com', '{env.HOST}', 'c.example.com')],
            },
        };
        expect(collectManagedDomains(null, servers)).toEqual(new Set(['c.example.com']));
    });
});

describe('isManagedDomain', () => {
    it('maps wildcard cert directories back to the wildcard name', () => {
        const managed = new Set(['*.example.com']);
        expect(isManagedDomain('wildcard_.example.com', managed)).toBe(true);
        expect(isManagedDomain('a.example.com', managed)).toBe(false);
    });
});

import { describe, expect, it } from 'vitest';
import { collectRouteTargets, failureReason, getListenPort, getServerScheme, isRouteUp, sanitizeHostList } from '../src/routeChecks.js';

const route = (host, extra = {}) => ({ match: [{ host: [host] }], handle: [], ...extra });

describe('getListenPort', () => {
    it('reads the port from common listen forms', () => {
        expect(getListenPort({ listen: [':443'] })).toBe(443);
        expect(getListenPort({ listen: ['0.0.0.0:8443'] })).toBe(8443);
        expect(getListenPort({ listen: ['tcp/:80'] })).toBe(80);
    });

    it('skips HTTP/3 udp listeners', () => {
        expect(getListenPort({ listen: ['udp/:443', ':8443'] })).toBe(8443);
    });

    it('takes the first port of a range', () => {
        expect(getListenPort({ listen: [':8000-8010'] })).toBe(8000);
    });

    it('returns null without listeners', () => {
        expect(getListenPort({})).toBeNull();
    });
});

describe('getServerScheme', () => {
    it('uses http on port 80', () => {
        expect(getServerScheme({}, 80)).toBe('http');
    });

    it('uses https elsewhere by default', () => {
        expect(getServerScheme({}, 443)).toBe('https');
        expect(getServerScheme({}, 8443)).toBe('https');
    });

    it('uses http when automatic HTTPS is disabled without TLS policies', () => {
        expect(getServerScheme({ automatic_https: { disable: true } }, 8080)).toBe('http');
        expect(getServerScheme({ automatic_https: { disable: true }, tls_connection_policies: [{}] }, 8443)).toBe('https');
    });
});

describe('collectRouteTargets', () => {
    it('builds one target per host with the server port and scheme', () => {
        const servers = {
            srv0: { listen: [':443'], routes: [route('a.example.com'), route('b.internal')] },
            srv1: { listen: [':80'], routes: [route('plain.example.com')] },
        };
        expect(collectRouteTargets(servers)).toEqual([
            { host: 'a.example.com', scheme: 'https', port: 443, server: 'srv0' },
            { host: 'b.internal', scheme: 'https', port: 443, server: 'srv0' },
            { host: 'plain.example.com', scheme: 'http', port: 80, server: 'srv1' },
        ]);
    });

    it('skips routes without a concrete host', () => {
        const servers = {
            srv0: {
                listen: [':443'],
                routes: [
                    { handle: [] },
                    { match: [{ path: ['/api/*'] }], handle: [] },
                    route('*.example.com'),
                    route('{$SITE}'),
                ],
            },
        };
        expect(collectRouteTargets(servers)).toEqual([]);
    });

    it('dedupes hosts across routes and servers', () => {
        const servers = {
            srv0: { listen: [':443'], routes: [route('a.example.com'), route('a.example.com')] },
            srv1: { listen: [':8443'], routes: [route('a.example.com')] },
        };
        expect(collectRouteTargets(servers)).toHaveLength(1);
    });

    it('skips excluded hosts, ignoring case', () => {
        const servers = { srv0: { listen: [':443'], routes: [route('a.example.com'), route('Files.Example.com')] } };
        expect(collectRouteTargets(servers, ['files.example.com']).map(t => t.host)).toEqual(['a.example.com']);
    });

    it('skips servers without a TCP listener', () => {
        expect(collectRouteTargets({ srv0: { routes: [route('a.example.com')] } })).toEqual([]);
    });
});

describe('isRouteUp', () => {
    it('treats success, redirects, and auth challenges as up', () => {
        for (const code of [200, 204, 301, 302, 308, 401, 403, 404]) expect(isRouteUp(code)).toBe(true);
    });

    it('treats server errors and no response as down', () => {
        for (const code of [500, 502, 503, 504, 0, null, undefined]) expect(isRouteUp(code)).toBe(false);
    });
});

describe('failureReason', () => {
    it('is null for an online route', () => {
        expect(failureReason({ online: true, statusCode: 200, error: null })).toBeNull();
    });

    it('reports the status code a route answered with', () => {
        expect(failureReason({ online: false, statusCode: 500, error: null })).toBe('HTTP 500');
    });

    it('reports the error when nothing answered', () => {
        expect(failureReason({ online: false, statusCode: null, error: 'certificate has expired' })).toBe('certificate has expired');
        expect(failureReason({ online: false, statusCode: null, error: null })).toBe('No response');
    });
});

describe('sanitizeHostList', () => {
    it('trims, lowercases, and dedupes hosts', () => {
        expect(sanitizeHostList([' Files.Example.com ', 'files.example.com', 'b.internal'])).toEqual(['files.example.com', 'b.internal']);
    });

    it('drops non-strings, empty, and overlong entries', () => {
        expect(sanitizeHostList(['ok.internal', '', '   ', 42, null, 'x'.repeat(254)])).toEqual(['ok.internal']);
    });

    it('returns an empty list for anything but an array', () => {
        expect(sanitizeHostList('files.example.com')).toEqual([]);
        expect(sanitizeHostList(undefined)).toEqual([]);
    });
});

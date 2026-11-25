import { describe, expect, it } from 'vitest';
import { getRouteHost, getRouteStatus, getRouteTitle } from '../src/utils/routes.js';

const route = (...hosts) => ({ match: [{ host: hosts }] });

describe('route display titles', () => {
    it.each([
        ['example.de', 'example'],
        ['jellyfin.example.de', 'jellyfin'],
        ['home.example.de', 'home'],
        ['grafana.monitoring.example.de', 'grafana'],
        ['my-app.example.de', 'my-app'],
        ['NAS.home.arpa.', 'NAS'],
        ['localhost', 'localhost'],
    ])('uses the leftmost DNS label of %s', (host, title) => {
        expect(getRouteTitle(route(host))).toBe(title);
    });

    it.each([
        '*.example.de', '{env.DOMAIN}', '192.168.1.20', '::1', '[::1]',
        ':8080', 'example.de:443', 'https://example.de', 'bad_name.example.de',
        '-bad.example.de', 'bad-.example.de', 'bad..example.de',
        'a'.repeat(64) + '.example.de', Array(5).fill('a'.repeat(63)).join('.'),
    ])('leaves unsuitable host %s untitled', host => {
        expect(getRouteTitle(route(host))).toBe('');
    });

    it('leaves hostless routes untitled', () => {
        expect(getRouteTitle({})).toBe('');
        expect(getRouteTitle({ match: [{ path: ['/'] }] })).toBe('');
        expect(getRouteTitle(route())).toBe('');
    });

    it('uses the first hostname of a multi-host route', () => {
        expect(getRouteTitle(route('home.example.de', 'media.example.de'))).toBe('home');
        expect(getRouteTitle(route('*.example.de', 'media.example.de'))).toBe('');
    });

    it('preserves explicit titles and restores the fallback when cleared', () => {
        const entry = route('home.example.de');
        expect(getRouteTitle(entry, 'Home Assistant')).toBe('Home Assistant');
        expect(getRouteTitle(entry, '')).toBe('home');
        expect(getRouteTitle(route('*.example.de'), 'Wildcard services')).toBe('Wildcard services');
    });
});

describe('route status', () => {
    const proxy = (host, ...dials) => ({
        match: host ? [{ host: [host] }] : undefined,
        handle: [{ handler: 'subroute', routes: [{ handle: [{ handler: 'reverse_proxy', upstreams: dials.map(dial => ({ dial })) }] }] }],
    });
    const status = (entry, { online = {}, uptime = {}, routeUptime = {}, routeChecks = false, excludes = [] } = {}) =>
        getRouteStatus(entry, { uptime, routeUptime, routeChecks, excludes: new Set(excludes), isOnline: dial => online[dial] });
    const stats = overrides => ({ total: 10, pct: 90, currentlyOnline: true, ...overrides });

    it.each([
        [{}, 'unknown'],
        [{ a: true, b: true }, 'online'],
        [{ a: true, b: false }, 'partial'],
        [{ a: true }, 'partial'],
        [{ a: false, b: false }, 'offline'],
    ])('follows all of its upstreams: %o', (online, expected) => {
        expect(status(proxy('app.example', 'a', 'b'), { online }).status).toBe(expected);
    });

    it('has nothing to check without an upstream', () => {
        expect(status({ match: [{ host: ['files.example'] }], handle: [{ handler: 'file_server' }] }))
            .toMatchObject({ status: 'none', history: null, pct: null });
    });

    it('takes uptime and history from its first upstream, once checked twice', () => {
        const entry = proxy('app.example', 'a', 'b');
        expect(status(entry, { uptime: { a: stats({ total: 1 }) } })).toMatchObject({ pct: null, history: { upstream: 'a' } });
        expect(status(entry, { uptime: { a: stats({ total: 2, pct: 50 }), b: stats() } }).pct).toBe(50);
    });

    it('uses its own check when route checks are on, even without an upstream', () => {
        const options = { routeChecks: true, online: { a: true } };
        expect(status(proxy('app.example', 'a'), options)).toMatchObject({ status: 'unknown', upstreamState: 'online', history: { route: 'app.example' } });
        expect(status(proxy('app.example'), { ...options, routeUptime: { 'app.example': stats({ total: 1 }) } })).toMatchObject({ status: 'online', pct: 90 });
        expect(status(proxy('app.example', 'a'), { ...options, routeUptime: { 'app.example': stats({ currentlyOnline: false, lastFailure: 'HTTP 502' }) } }))
            .toMatchObject({ status: 'offline', failure: 'HTTP 502' });
    });

    it('follows its upstreams when excluded from route checks or not requestable by name', () => {
        const routeUptime = { 'App.example': stats({ currentlyOnline: false }) };
        expect(status(proxy('App.example', 'a'), { routeChecks: true, excludes: ['app.example'], routeUptime, online: { a: true } }))
            .toMatchObject({ status: 'online', probeHost: 'App.example', excluded: true, checkHost: null, failure: null });
        for (const host of ['*.example', '{env.HOST}', null]) {
            expect(status(proxy(host, 'a'), { routeChecks: true, online: { a: true } })).toMatchObject({ status: 'online', probeHost: null });
        }
    });

    it('identifies a route by its hosts, and a hostless one by nothing', () => {
        expect(getRouteHost(route('a.example', 'b.example'))).toBe('a.example, b.example');
        expect(getRouteHost({})).toBe('');
    });
});

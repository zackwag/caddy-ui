import { describe, expect, it } from 'vitest';
import { getRouteTitle } from '../src/utils/routes.js';

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

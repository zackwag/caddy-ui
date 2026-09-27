import { describe, expect, it } from 'vitest';
import { extractUpstreams, getHost } from '../src/routes/health.js';

describe('extractUpstreams', () => {
    it('extracts dial addresses from reverse_proxy handlers', () => {
        const route = {
            handle: [{
                handler: 'reverse_proxy',
                upstreams: [{ dial: 'localhost:8080' }],
            }],
        };
        expect(extractUpstreams(route)).toEqual(['localhost:8080']);
    });

    it('extracts from nested subroute handlers', () => {
        const route = {
            handle: [{
                handler: 'subroute',
                routes: [{
                    handle: [{
                        handler: 'reverse_proxy',
                        upstreams: [{ dial: 'app:3000' }],
                    }],
                }],
            }],
        };
        expect(extractUpstreams(route)).toEqual(['app:3000']);
    });

    it('extracts multiple upstreams', () => {
        const route = {
            handle: [{
                handler: 'reverse_proxy',
                upstreams: [
                    { dial: 'app1:3000' },
                    { dial: 'app2:3001' },
                ],
            }],
        };
        expect(extractUpstreams(route)).toEqual(['app1:3000', 'app2:3001']);
    });

    it('returns empty array for non-proxy handlers', () => {
        const route = {
            handle: [{ handler: 'file_server' }],
        };
        expect(extractUpstreams(route)).toEqual([]);
    });

    it('returns empty array for missing handle', () => {
        expect(extractUpstreams({})).toEqual([]);
    });

    it('skips upstreams without dial', () => {
        const route = {
            handle: [{
                handler: 'reverse_proxy',
                upstreams: [{ dial: 'app:3000' }, {}],
            }],
        };
        expect(extractUpstreams(route)).toEqual(['app:3000']);
    });
});

describe('getHost', () => {
    it('returns the first host from match', () => {
        const route = { match: [{ host: ['app.example.com'] }] };
        expect(getHost(route)).toBe('app.example.com');
    });

    it('returns null when no host matcher', () => {
        const route = { match: [{ path: ['/api/*'] }] };
        expect(getHost(route)).toBeNull();
    });

    it('returns null when no match', () => {
        expect(getHost({})).toBeNull();
    });
});

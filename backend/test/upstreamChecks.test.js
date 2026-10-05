import { describe, expect, it } from 'vitest';
import { extractUpstreamTargets, extractUpstreams, getHost, isUpstreamOnline } from '../src/upstreamChecks.js';

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

describe('extractUpstreamTargets', () => {
    it('has no passive policy without health checks', () => {
        const route = { handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'app:3000' }] }] };
        expect(extractUpstreamTargets(route)).toEqual([{ dial: 'app:3000', passive: null }]);
    });

    it('has no passive policy with only active health checks', () => {
        const route = {
            handle: [{
                handler: 'reverse_proxy',
                health_checks: { active: { uri: '/health' } },
                upstreams: [{ dial: 'app:3000' }],
            }],
        };
        expect(extractUpstreamTargets(route)[0].passive).toBeNull();
    });

    it('has no passive policy when fail_duration is zero or missing', () => {
        for (const passive of [{ max_fails: 3 }, { fail_duration: 0 }, { fail_duration: '0s' }]) {
            const route = { handle: [{ handler: 'reverse_proxy', health_checks: { passive }, upstreams: [{ dial: 'app:3000' }] }] };
            expect(extractUpstreamTargets(route)[0].passive).toBeNull();
        }
    });

    it('reads max_fails from passive health checks, defaulting to 1', () => {
        const target = (passive) => extractUpstreamTargets({
            handle: [{ handler: 'reverse_proxy', health_checks: { passive }, upstreams: [{ dial: 'app:3000' }] }],
        })[0].passive;
        expect(target({ fail_duration: 30000000000 })).toEqual({ maxFails: 1 });
        expect(target({ fail_duration: '30s', max_fails: 3 })).toEqual({ maxFails: 3 });
    });

    it('takes the passive policy from the handler each upstream belongs to', () => {
        const route = {
            handle: [{
                handler: 'subroute',
                routes: [
                    { handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'a:1' }] }] },
                    { handle: [{ handler: 'reverse_proxy', health_checks: { passive: { fail_duration: '10s' } }, upstreams: [{ dial: 'b:2' }] }] },
                ],
            }],
        };
        expect(extractUpstreamTargets(route)).toEqual([
            { dial: 'a:1', passive: null },
            { dial: 'b:2', passive: { maxFails: 1 } },
        ]);
    });
});

describe('isUpstreamOnline', () => {
    it('is offline when the dial fails, whatever the pool says', () => {
        expect(isUpstreamOnline(false, null, { fails: 0 })).toBe(false);
        expect(isUpstreamOnline(false, { maxFails: 1 }, { fails: 0 })).toBe(false);
    });

    it('ignores pool fails without passive health checks', () => {
        expect(isUpstreamOnline(true, null, { fails: 5 })).toBe(true);
    });

    it('is offline once passive fails reach max_fails', () => {
        expect(isUpstreamOnline(true, { maxFails: 1 }, { fails: 1 })).toBe(false);
        expect(isUpstreamOnline(true, { maxFails: 3 }, { fails: 3 })).toBe(false);
    });

    it('stays online below max_fails or when missing from the pool', () => {
        expect(isUpstreamOnline(true, { maxFails: 3 }, { fails: 2 })).toBe(true);
        expect(isUpstreamOnline(true, { maxFails: 1 }, undefined)).toBe(true);
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

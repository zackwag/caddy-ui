import { describe, expect, it } from 'vitest';
import { routeExpectation } from '../src/configExpectation.js';

describe('route expectations', () => {
    it('replaces or removes a nested route by ID without changing its siblings or the input', () => {
        const previous = { apps: { http: { servers: { other: { routes: [{ '@id': 'sibling' }] },
            srv0: { routes: [{ handle: [{ handler: 'subroute', routes: [{ '@id': 'target', handle: [] }] }] }] } } } } };
        const original = structuredClone(previous);
        const route = { '@id': 'target', handle: [{ handler: 'static_response', body: 'new' }] };
        const next = routeExpectation({ operation: 'replace', id: 'target', route })(previous);
        expect(next.apps.http.servers.srv0.routes[0].handle[0].routes).toEqual([route]);
        expect(next.apps.http.servers.other).toEqual(previous.apps.http.servers.other);
        route.handle[0].body = 'mutated after submission';
        expect(next.apps.http.servers.srv0.routes[0].handle[0].routes[0].handle[0].body).toBe('new');
        const removed = routeExpectation({ operation: 'remove', id: 'target' })(previous);
        expect(removed.apps.http.servers.srv0.routes[0].handle[0].routes).toEqual([]);
        expect(previous).toEqual(original);
    });

    it('does not invent a baseline when the server or unique target ID is unknown', () => {
        const replace = routeExpectation({ operation: 'replace', id: 'target', route: { '@id': 'target' } });
        expect(replace(undefined)).toBeUndefined();
        expect(replace({ routes: [] })).toBeUndefined();
        expect(replace({ routes: [{ '@id': 'target' }, { '@id': 'target' }] })).toBeUndefined();
        for (const serverName of ['absent', '__proto__', 'constructor']) {
            expect(routeExpectation({ operation: 'add', serverName, route: {} })({ apps: { http: { servers: {} } } })).toBeUndefined();
        }
    });
});

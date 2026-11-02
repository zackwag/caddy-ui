import { describe, expect, it } from 'vitest';
import { documentationLink } from '../src/utils/documentationLink.js';

const resolver = 'https://zackwag.github.io/caddy-ui/resolve.html';

describe('sidebar documentation link', () => {
    it.each([
        ['3.7.4', '3.7.4'],
        ['3.7.4', '3.7.3'],
        ['dev', 'dev'],
        ['edge-abc123', 'edge-def456'],
        ['beta-abc123', 'beta-def456'],
        ['1.13', '1.13'],
    ])('forwards frontend %s and backend %s independently without resolving them in the app', (frontend, backend) => {
        const url = new URL(documentationLink({ frontend, backend }));
        expect(url.origin + url.pathname).toBe(resolver);
        expect([...url.searchParams]).toEqual([['frontend', frontend], ['backend', backend]]);
    });

    it.each([undefined, null, '', '   ', 123])('omits an unavailable backend version (%s) rather than copying the frontend version', backend => {
        expect(documentationLink({ frontend: '3.7.4', backend })).toBe(resolver + '?frontend=3.7.4');
    });

    it('does not invent a frontend version or copy the backend', () => {
        expect(documentationLink({ backend: '3.7.4' })).toBe(resolver + '?backend=3.7.4');
        expect(documentationLink()).toBe(resolver);
    });

    it('includes only version parameters and encodes values as data', () => {
        const url = new URL(documentationLink({ frontend: 'dev&instance=private', backend: '3.7.4', token: 'secret', instance: 'private' }));
        expect([...url.searchParams]).toEqual([['frontend', 'dev&instance=private'], ['backend', '3.7.4']]);
        expect(url.username).toBe('');
        expect(url.password).toBe('');
        expect(url.hash).toBe('');
    });
});

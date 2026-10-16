import { describe, expect, it } from 'vitest';
import { serverIdsFromConfig } from '../src/routes/instances.js';

describe('serverIdsFromConfig', () => {
    it('returns sorted server IDs', () => {
        expect(serverIdsFromConfig({ srv1: {}, srv0: {}, remaining_auto_https_redirects: {} }))
            .toEqual(['remaining_auto_https_redirects', 'srv0', 'srv1']);
    });

    it('returns an empty list when no http app is configured', () => {
        expect(serverIdsFromConfig(null)).toEqual([]);
        expect(serverIdsFromConfig(undefined)).toEqual([]);
    });

    it('ignores non-object responses', () => {
        expect(serverIdsFromConfig('oops')).toEqual([]);
        expect(serverIdsFromConfig([])).toEqual([]);
    });
});

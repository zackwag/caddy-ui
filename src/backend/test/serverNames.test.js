import { describe, expect, it } from 'vitest';
import { migrateServerNames } from '../src/serverNames.js';

describe('migrateServerNames', () => {
    it('copies a legacy flat map to every instance', () => {
        expect(migrateServerNames({ srv0: 'HTTPS Sites' }, ['caddy', 'edge'])).toEqual({
            caddy: { srv0: 'HTTPS Sites' },
            edge: { srv0: 'HTTPS Sites' },
        });
    });

    it('leaves a legacy file alone when there are no instances yet', () => {
        expect(migrateServerNames({ srv0: 'HTTPS Sites' }, [])).toBeNull();
    });

    it('keeps the per-instance format as is', () => {
        const names = { caddy: { srv0: 'HTTPS Sites' }, edge: { srv1: 'HTTP' } };
        expect(migrateServerNames(names, ['caddy'])).toEqual(names);
    });

    it('drops malformed instance entries', () => {
        expect(migrateServerNames({ caddy: { srv0: 'A' }, bad: { srv0: 5 }, worse: [] }, ['caddy']))
            .toEqual({ caddy: { srv0: 'A' } });
    });

    it('handles empty and unusable files', () => {
        expect(migrateServerNames({}, ['caddy'])).toEqual({});
        expect(migrateServerNames(null, ['caddy'])).toBeNull();
        expect(migrateServerNames([], ['caddy'])).toBeNull();
    });
});

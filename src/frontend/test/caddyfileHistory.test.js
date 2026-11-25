import { describe, expect, it } from 'vitest';
import { historyActor, historyComparison } from '../src/utils/caddyfileHistory.js';
import i18n from '../src/i18n/index.js';

describe('Caddyfile version presentation', () => {
    it('compares a commit with its recorded predecessor when still retained', () => {
        const entry = { filename: 'new', parent: 'old' };
        expect(historyComparison(entry, [entry, { filename: 'old' }])).toBe('old');
        expect(historyComparison(entry, [entry])).toBe('current');
        expect(historyComparison({ filename: 'legacy' }, [])).toBe('current');
    });

    it('distinguishes accounts and tokens, without guessing an unknown identity', () => {
        const t = i18n.t.bind(i18n);
        expect(historyActor({ actor: { type: 'user', name: 'administrator' } }, t)).toBe('User: administrator');
        expect(historyActor({ actor: { type: 'api-token', name: 'Automation' } }, t)).toBe('API token: Automation');
        expect(historyActor({ actor: null }, t)).toBe('Unknown');
        expect(historyActor({ actor: { type: 'user', name: null, id: 'retired' } }, t)).toBe('Unknown');
    });
});

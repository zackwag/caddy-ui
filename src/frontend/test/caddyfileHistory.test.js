import { describe, expect, it, vi } from 'vitest';
import { historyActor, historyComparison, notifyConfigurationSave } from '../src/utils/caddyfileHistory.js';
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

describe('configuration save notifications', () => {
    const t = key => key;
    const toast = () => ({ success: vi.fn(), info: vi.fn() });

    it.each([
        ['CONFIG_VERIFICATION_MISMATCH', 'errors.configVerificationMismatch'],
        ['CONFIG_VERIFICATION_UNAVAILABLE', 'errors.configVerificationUnavailable'],
        ['CADDYFILE_HISTORY_COMMIT_FAILED', 'errors.caddyfileHistoryCommitFailed'],
        [undefined, 'errors.operationWarning'],
        ['UNKNOWN_WARNING', 'errors.operationWarning'],
    ])('names the warning %s', (warningCode, key) => {
        const notify = toast();
        const result = { ok: true, warning: 'server detail', warningCode };
        notifyConfigurationSave(notify, t, result, 'saved');
        expect(notify.info).toHaveBeenCalledWith(key, result);
        expect(notify.success).not.toHaveBeenCalled();
    });

    it('reports a clean save as success', () => {
        const notify = toast();
        notifyConfigurationSave(notify, t, { ok: true, verification: { file: 'verified', live: 'verified' } }, 'saved');
        expect(notify.success).toHaveBeenCalledWith('saved');
    });
});

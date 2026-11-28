import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/locales/en.js';
import { localizeError } from '../src/utils/errorMessages.js';
import { ERROR_MESSAGES } from '../src/utils/errorRegistry.js';

describe('localizeError', () => {
    const t = key => key;
    afterEach(() => vi.unstubAllGlobals());

    it('localizes supported stable error codes', () => {
        expect(localizeError({ code: 'VALIDATION_FAILED', message: 'private error' }, t)).toBe('errors.validationFailed');
        expect(localizeError({ code: 'NETWORK_ERROR' }, t)).toBe('errors.network');
    });
    it('interpolates only the browser origin into messages', () => {
        vi.stubGlobal('location', { origin: 'https://ui.example' });
        const translate = vi.fn();
        localizeError({ code: 'EXTERNAL_URL_REQUIRED', origin: 'https://attacker.example' }, translate);
        expect(translate.mock.calls).toEqual([['errors.externalUrlRequired', { origin: 'https://ui.example' }]]);
    });
    it('never exposes server-supplied error strings', () => {
        expect(localizeError({ code: 'UNEXPECTED', message: 'connection secret' }, t)).toBe('errors.generic');
        expect(localizeError(new Error('private file path'), t)).toBe('errors.generic');
    });
    it('has an English message for every registered code', () => {
        const message = key => key.split('.').reduce((catalog, name) => catalog?.[name], en);
        expect(Object.values(ERROR_MESSAGES).filter(key => typeof message(key) !== 'string')).toEqual([]);
    });
});

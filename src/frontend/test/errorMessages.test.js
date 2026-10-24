import { describe, expect, it } from 'vitest';
import { localizeError } from '../src/utils/errorMessages.js';

describe('localizeError', () => {
    const t = key => key;
    it('localizes supported stable error codes', () => {
        expect(localizeError({ code: 'VALIDATION_FAILED', message: 'private error' }, t)).toBe('errors.validationFailed');
        expect(localizeError({ code: 'NETWORK_ERROR' }, t)).toBe('errors.network');
    });
    it('interpolates only the browser origin into messages', () => {
        const calls = [];
        localizeError({ code: 'EXTERNAL_URL_REQUIRED', origin: 'https://attacker.example' }, (key, options) => { calls.push([key, options]); return key; });
        expect(calls).toEqual([['errors.externalUrlRequired', { origin: globalThis.location?.origin }]]);
    });
    it('never exposes server-supplied error strings', () => {
        expect(localizeError({ code: 'UNEXPECTED', message: 'connection secret' }, t)).toBe('errors.generic');
        expect(localizeError(new Error('private file path'), t)).toBe('errors.generic');
    });
});

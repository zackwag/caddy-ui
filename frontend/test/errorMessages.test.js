import { describe, expect, it } from 'vitest';
import { localizeError } from '../src/utils/errorMessages.js';

describe('localizeError', () => {
    const t = key => key;
    it('localizes supported stable error codes', () => {
        expect(localizeError({ code: 'VALIDATION_FAILED', message: 'private error' }, t)).toBe('errors.validationFailed');
        expect(localizeError({ code: 'NETWORK_ERROR' }, t)).toBe('errors.network');
    });
    it('never exposes server-supplied error strings', () => {
        expect(localizeError({ code: 'UNEXPECTED', message: 'connection secret' }, t)).toBe('errors.generic');
        expect(localizeError(new Error('private file path'), t)).toBe('errors.generic');
    });
});

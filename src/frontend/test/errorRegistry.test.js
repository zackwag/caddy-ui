import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES } from '../src/utils/errorRegistry.js';
import { localizeError } from '../src/utils/errorMessages.js';
import en from '../src/i18n/locales/en.js';

describe('semantic error presentation registry', () => {
    const t = key => key;
    it('localizes distinct application errors', () => {
        expect(localizeError({ code: 'CERTIFICATE_DELETE_DENIED' }, t)).toBe('errors.certificateDeleteDenied');
        expect(localizeError({ code: 'CADDYFILE_READ_FAILED' }, t)).toBe('errors.caddyfileReadFailed');
        expect(localizeError({ code: 'MADE_UP', message: 'private' }, t)).toBe('errors.generic');
    });
    it('has English fallback for every registered message', () => {
        for (const key of Object.values(ERROR_MESSAGES)) {
            const [, name] = key.split('.');
            expect(typeof en.errors[name]).toBe('string');
        }
    });
    it.each([
        ['FORBIDDEN', 'errors.forbidden'],
        ['LOG_FILE_MISSING', 'errors.logFileMissing'],
        ['LOG_READ_FAILED', 'errors.logReadFailed'],
        ['LOG_SOURCE_UNAVAILABLE', 'errors.logSourceUnavailable'],
        ['LOG_STREAM_ERROR', 'errors.logStreamError'],
    ])('localizes the reviewed backend code %s', (code, key) => {
        expect(localizeError({ code, error: 'private backend detail' }, t)).toBe(key);
    });
});

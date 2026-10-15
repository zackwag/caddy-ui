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
    it('explains administrator action for internal ntfy destinations without exposing raw details', () => {
        const translate = key => en.errors[key.split('.')[1]];
        const message = localizeError({ code: 'NTFY_DESTINATION_BLOCKED', message: 'private URL with secret topic' }, translate);
        expect(message).toContain('backend environment');
        expect(message).toContain('contact your administrator');
        expect(message).not.toContain('secret topic');
        const other = localizeError({ code: 'WEBHOOK_DESTINATION_BLOCKED' }, translate);
        expect(other).toContain('supported only for ntfy');
    });
    it.each([
        ['FORBIDDEN', 'errors.forbidden'],
        ['NTFY_DESTINATION_BLOCKED', 'errors.ntfyDestinationBlocked'],
        ['WEBHOOK_DESTINATION_BLOCKED', 'errors.webhookDestinationBlocked'],
        ['LOG_FILE_MISSING', 'errors.logFileMissing'],
        ['LOG_STREAM_ERROR', 'errors.logStreamError'],
    ])('localizes the reviewed backend code %s', (code, key) => {
        expect(localizeError({ code, error: 'private backend detail' }, t)).toBe(key);
    });
});

import { describe, expect, it } from 'vitest';
import { AppError, asAppError, errorChain } from '../src/AppError.js';

describe('semantic application errors', () => {
    it('requires a registered code and preserves the cause chain', () => {
        const cause = Object.assign(new Error('permission denied'), { code: 'EACCES' });
        const appError = new AppError('CADDYFILE_READ_FAILED', { cause, context: { instanceId: 'test' } });
        expect(errorChain(appError).map(e => e.code)).toEqual(['CADDYFILE_READ_FAILED', 'EACCES']);
        expect(() => new AppError('MADE_UP_CODE')).toThrow(TypeError);
        expect(asAppError(appError, 'REQUEST_FAILED')).toBe(appError);
    });
});

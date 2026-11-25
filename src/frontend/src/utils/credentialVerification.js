import { ApiError } from './api.js';
import { passkeyProblem, reauthenticateWithPasskey } from './passkeys.js';

export function canVerifyWithPasskey(authState) {
    return !!authState?.passkeyLoginAvailable && !passkeyProblem({ origin: authState.passkeyOrigin });
}

// Throws what a form shows when a new password and its confirmation differ.
export function requireMatchingPasswords({ password, confirmation }) {
    // eslint-disable-next-line i18next/no-literal-string -- Diagnostic and registered error code, localized where it's shown.
    if (password !== confirmation) throw new ApiError('Passwords do not match', { code: 'PASSWORD_MISMATCH' });
}

export const isTotpCode = code => /^\d{6}$/.test(code || '');

export function verificationMethod(value, authState) {
    // eslint-disable-next-line i18next/no-literal-string -- Internal verification method identifiers.
    return canVerifyWithPasskey(authState) && value.method !== 'password' ? 'passkey' : 'password';
}

export function verificationReady(value, authState) {
    return !!authState && (verificationMethod(value, authState) === 'passkey'
        || (!!value.currentPassword && (!authState.totpEnabled || isTotpCode(value.totpCode))));
}

export function credentialProof(value, authState, action) {
    return verificationMethod(value, authState) === 'passkey'
        ? reauthenticateWithPasskey(action)
        : { currentPassword: value.currentPassword, totpCode: value.totpCode };
}

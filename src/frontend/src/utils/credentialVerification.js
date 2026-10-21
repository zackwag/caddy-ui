import { passkeySupport, reauthenticateWithPasskey } from './passkeys.js';

export function canVerifyWithPasskey(authState) {
    const support = passkeySupport();
    return !!authState?.passkeyLoginAvailable && support.secure && support.supported
        && authState.passkeyOrigin === window.location.origin;
}

export function verificationMethod(value, authState) {
    // eslint-disable-next-line i18next/no-literal-string -- Internal verification method identifiers.
    return canVerifyWithPasskey(authState) && value.method !== 'password' ? 'passkey' : 'password';
}

export function verificationReady(value, authState) {
    return !!authState && (verificationMethod(value, authState) === 'passkey'
        || (!!value.currentPassword && (!authState.totpEnabled || /^\d{6}$/.test(value.totpCode || ''))));
}

export function credentialProof(value, authState, action, onUnauth) {
    return verificationMethod(value, authState) === 'passkey'
        ? reauthenticateWithPasskey(action, onUnauth)
        : { currentPassword: value.currentPassword, totpCode: value.totpCode };
}

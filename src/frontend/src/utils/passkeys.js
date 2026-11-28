/* eslint-disable i18next/no-literal-string -- WebAuthn protocol identifiers and internal diagnostics; UI messages use the error registry */

import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { ApiError, authRequest } from './api.js';

// Why passkeys registered for `origin` can't be used on this page, as a message
// key and its values, or null. `reason` and `enabled` are what the backend says
// about its own configuration.
export function passkeyProblem({ origin, reason = null, enabled = true }) {
    if (window.location.protocol !== 'https:' || !window.isSecureContext) return { key: 'passkeys.httpsRequired' };
    if (!browserSupportsWebAuthn()) return { key: 'passkeys.unsupported' };
    if (reason === 'ip-address') return { key: 'errors.passkeyIpUnavailable' };
    if (!enabled) return { key: 'errors.passkeyUnavailable' };
    return origin === window.location.origin ? null : { key: 'passkeys.originMismatch', values: { origin } };
}

async function ceremony(start, optionsJSON) {
    try { return await start({ optionsJSON }); }
    catch (error) {
        const cancelled = ['NotAllowedError', 'AbortError'].includes(error.name)
            || ['NotAllowedError', 'AbortError'].includes(error.cause?.name);
        throw new ApiError('Passkey ceremony failed', { code: cancelled ? 'PASSKEY_CANCELLED' : 'PASSKEY_BROWSER_ERROR' });
    }
}

export async function registerPasskey(name, proof) {
    const options = await authRequest('/passkeys/registration/options', { method: 'POST', json: { name, ...proof } });
    const response = await ceremony(startRegistration, options);
    return authRequest('/passkeys/registration', { method: 'POST', json: response });
}

export async function signInWithPasskey() {
    const options = await authRequest('/passkeys/authentication/options', { method: 'POST' });
    const response = await ceremony(startAuthentication, options);
    return authRequest('/passkeys/authentication', { method: 'POST', json: response });
}

export async function reauthenticateWithPasskey(action) {
    const options = await authRequest('/passkeys/reauthentication/options', { method: 'POST', json: { action } });
    const response = await ceremony(startAuthentication, options);
    return authRequest('/passkeys/reauthentication', { method: 'POST', json: response });
}

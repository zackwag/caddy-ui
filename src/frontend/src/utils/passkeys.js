/* eslint-disable i18next/no-literal-string -- WebAuthn protocol identifiers and internal diagnostics; UI messages use the error registry */

import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { ApiError, authRequest } from './api.js';

export function passkeySupport() {
    return { secure: window.location.protocol === 'https:' && window.isSecureContext,
        supported: browserSupportsWebAuthn() };
}

async function ceremony(start, optionsJSON) {
    try { return await start({ optionsJSON }); }
    catch (error) {
        const cancelled = ['NotAllowedError', 'AbortError'].includes(error.name)
            || ['NotAllowedError', 'AbortError'].includes(error.cause?.name);
        throw new ApiError('Passkey ceremony failed', { code: cancelled ? 'PASSKEY_CANCELLED' : 'PASSKEY_BROWSER_ERROR' });
    }
}

export async function registerPasskey(name, proof, onUnauth) {
    const options = await authRequest('/passkeys/registration/options', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ...proof }) }, onUnauth);
    const response = await ceremony(startRegistration, options);
    return authRequest('/passkeys/registration', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(response) }, onUnauth);
}

export async function signInWithPasskey() {
    const options = await authRequest('/passkeys/authentication/options', { method: 'POST' });
    const response = await ceremony(startAuthentication, options);
    return authRequest('/passkeys/authentication', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(response) });
}

export async function reauthenticateWithPasskey(action, onUnauth) {
    const options = await authRequest('/passkeys/reauthentication/options', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }, onUnauth);
    const response = await ceremony(startAuthentication, options);
    return authRequest('/passkeys/reauthentication', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(response) }, onUnauth);
}

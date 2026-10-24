import { ERROR_MESSAGES } from './errorRegistry.js';

// Protocol codes map to presentation keys. Unknown or untrusted codes are generic.
// The browser's own origin is the only interpolated value, never server data.
export function localizeError(error, t) {
    const code = error?.code || error?.errorCode;
    return t(Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : 'errors.generic', { origin: globalThis.location?.origin });
}

import { ERROR_MESSAGES } from './errorRegistry.js';

// Protocol codes map to presentation keys. Unknown or untrusted codes are generic.
const messageKey = (code, fallback) => Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : fallback;

// The browser's own origin is the only interpolated value, never server data.
export function localizeError(error, t) {
    return t(messageKey(error?.code, 'errors.generic'), { origin: globalThis.location?.origin });
}

// A known warning code names what to check; anything else stays generic.
export function localizeWarning(result, t) {
    return t(messageKey(result.warningCode, 'errors.operationWarning'));
}

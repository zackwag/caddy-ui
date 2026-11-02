export const API_TOKEN_SCOPES = Object.freeze(['status:read', 'metrics:read']);
export const MAX_API_TOKENS = 64;

function uniqueStrings(values, allowed) {
    return Array.isArray(values) && values.length > 0 && values.length <= 128
        && new Set(values).size === values.length
        && values.every(value => typeof value === 'string' && value.length > 0 && value.length <= 128 && (!allowed || allowed.includes(value)));
}

export function validApiTokenInput(value) {
    return value && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.trim().length <= 80
        && uniqueStrings(value.scopes, API_TOKEN_SCOPES) && uniqueStrings(value.instanceIds)
        && Number.isInteger(value.expiresInDays) && value.expiresInDays >= 1 && value.expiresInDays <= 365;
}

export function validApiTokenRecord(value) {
    return value && typeof value.id === 'string' && /^[a-f0-9]{32}$/.test(value.id)
        && typeof value.hash === 'string' && /^[a-f0-9]{64}$/.test(value.hash)
        && validApiTokenInput({ ...value, expiresInDays: 1 })
        && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
        && typeof value.expiresAt === 'string' && Date.parse(value.expiresAt) > Date.parse(value.createdAt);
}

// Exact routes only: new endpoints never inherit integration access implicitly.
export function apiTokenScope(method, path) {
    if (!['GET', 'HEAD'].includes(method)) return null;
    if (/^\/status\/?$/.test(path)) return 'status:read';
    if (/^\/metrics(?:\/raw)?\/?$/.test(path)) return 'metrics:read';
    return null;
}

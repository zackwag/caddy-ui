const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Methods that never change anything, so write protections don't apply to them.
export function isSafeMethod(method) {
    return SAFE_METHODS.has(method);
}

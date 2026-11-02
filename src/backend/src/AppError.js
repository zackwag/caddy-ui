import { ERROR_REGISTRY, errorDefinition } from './errorRegistry.js';

// Capture the cause once; report it at the API/worker boundary to avoid duplicate logs.
export class AppError extends Error {
    constructor(code, { cause, context = {}, message } = {}) {
        if (!Object.hasOwn(ERROR_REGISTRY, code)) throw new TypeError(`Unknown application error code: ${code}`);
        super(message || code, { cause });
        this.name = 'AppError';
        this.code = code;
        this.context = context;
        this.status = errorDefinition(code).status;
    }
}

export function asAppError(error, code, context = {}) {
    return error instanceof AppError ? error : new AppError(code, { cause: error, context });
}

export function errorChain(error) {
    const chain = [];
    const seen = new Set();
    let current = error;
    while (current && !seen.has(current) && chain.length < 8) {
        seen.add(current);
        chain.push({
            name: current.name || 'Error',
            code: current.code || null,
            message: current.message || String(current),
            ...(current.stack ? { stack: current.stack } : {}),
            ...(current.context ? { context: current.context } : {}),
        });
        current = current.cause;
    }
    return chain;
}

// Keep technical details in logs. Never serialize cause, stack, or context to the client.
export function publicError(error) {
    return { code: error.code, error: 'Operation failed' };
}

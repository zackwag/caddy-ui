import { resolve } from 'path';

const ALLOWED_PATH_PREFIXES = ['/etc/', '/var/', '/data/', '/opt/', '/tmp/', '/home/'];

export function validateUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('URL must use http or https');
    }
    return parsed.href;
}

export function validatePath(p) {
    if (typeof p !== 'string' || !p.startsWith('/')) {
        throw new Error('Path must be absolute');
    }
    if (p.includes('\0')) {
        throw new Error('Path contains null byte');
    }
    const resolved = resolve(p);
    if (!ALLOWED_PATH_PREFIXES.some(prefix => resolved.startsWith(prefix))) {
        throw new Error(`Path must be under one of: ${ALLOWED_PATH_PREFIXES.join(', ')}`);
    }
    return resolved;
}

export function validateContainerName(name) {
    return String(name).replace(/[^a-zA-Z0-9._-]/g, '');
}

export function validateServerName(name) {
    return String(name).replace(/[^a-zA-Z0-9._-]/g, '');
}

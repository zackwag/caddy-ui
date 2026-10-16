export const CAPTURE_VERSION = 1;

export function normalizeCapture(value, replacements = []) {
    const ids = new Map();
    let firstTimestamp;
    function visit(value) {
        if (typeof value === 'string') {
            for (const [from, to] of replacements) value = value.replaceAll(from, to);
            return value.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, id => {
                id = id.toLowerCase();
                if (!ids.has(id)) ids.set(id, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`);
                return ids.get(id);
            }).replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, timestamp => {
                const time = Date.parse(timestamp);
                if (firstTimestamp === undefined) firstTimestamp = time;
                return new Date(Date.parse('2025-01-01T12:00:00.000Z') + time - firstTimestamp).toISOString();
            });
        }
        if (Array.isArray(value)) return value.map(visit);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
        return value;
    }
    return visit(value);
}

export function validateCapture(capture) {
    if (capture?.formatVersion !== CAPTURE_VERSION || !/^[a-f0-9]{40}$/.test(capture.source?.commit || '')) {
        throw new Error('Unsupported capture format or missing source commit. Refresh the capture.');
    }
    if (!Array.isArray(capture.scenarios) || !capture.scenarios.length) throw new Error('Capture has no scenarios.');
    const ids = new Set();
    for (const scenario of capture.scenarios) {
        if (!scenario.id || ids.has(scenario.id) || !Array.isArray(scenario.requests)) throw new Error('Invalid or duplicate capture scenario.');
        if (scenario.clock !== undefined && (!Number.isSafeInteger(scenario.clock) || scenario.clock < 0)) {
            throw new Error('Invalid capture clock. Refresh the capture.');
        }
        ids.add(scenario.id);
        const requests = new Set();
        for (const record of scenario.requests) {
            const key = requestKey(record.request);
            if (requests.has(key) || !record.request.path.startsWith('/') ||
                !Number.isInteger(record.response?.status) || record.response.status < 100 || record.response.status > 599 ||
                !record.response.headers || !Object.hasOwn(record.response, 'body')) {
                throw new Error(`Invalid or duplicate response in ${scenario.id}: ${key}`);
            }
            requests.add(key);
        }
    }
    return capture;
}

export function requestKey({ method = 'GET', path, body = null }) {
    return JSON.stringify([method.toUpperCase(), path, body]);
}

// No network fallback. Both request and response bodies retain their captured shapes.
export function createReplayFetch(records, onMiss = () => {}, origin = 'http://preview.local') {
    const responses = new Map(records.map(record => [requestKey(record.request), record.response]));
    return async (input, options = {}) => {
        const request = input instanceof Request ? new Request(input, options) : new Request(new URL(input, origin), options);
        const url = new URL(request.url);
        let body = null;
        if (!['GET', 'HEAD'].includes(request.method)) {
            const text = await request.text();
            body = text ? (request.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text) : null;
        }
        const path = url.pathname.replace(/^\/api(?=\/|$)/, '') + url.search;
        const key = requestKey({ method: request.method, path, body });
        const response = url.origin === origin && url.pathname.startsWith('/api/') ? responses.get(key) : null;
        if (!response) {
            const message = `Unrecorded request: ${request.method} ${url.pathname}${url.search}`;
            onMiss(message);
            throw new Error(message);
        }
        if (request.signal.aborted) throw request.signal.reason;
        const contentType = new Headers(response.headers).get('content-type') || '';
        const responseBody = [204, 205, 304].includes(response.status) ? null
            : contentType.includes('application/json') ? JSON.stringify(response.body) : String(response.body);
        return new Response(responseBody, {
            status: response.status, headers: response.headers,
        });
    };
}

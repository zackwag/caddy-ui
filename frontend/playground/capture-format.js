export const CAPTURE_VERSION = 1;

export function validateCapture(capture) {
    if (capture?.formatVersion !== CAPTURE_VERSION || !/^[a-f0-9]{40}$/.test(capture.source?.commit || '')) {
        throw new Error('Unsupported capture format or missing source commit. Refresh the capture.');
    }
    if (!Array.isArray(capture.scenarios) || !capture.scenarios.length) throw new Error('Capture has no scenarios.');
    const ids = new Set();
    for (const scenario of capture.scenarios) {
        if (!scenario.id || ids.has(scenario.id) || !Array.isArray(scenario.requests)) throw new Error('Invalid or duplicate capture scenario.');
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
export function createReplayFetch(records, onMiss = () => {}) {
    const responses = new Map(records.map(record => [requestKey(record.request), record.response]));
    return async (input, options = {}) => {
        const request = new Request(new URL(typeof input === 'string' ? input : input.url, 'http://preview.local'), options);
        const url = new URL(request.url);
        let body = null;
        if (!['GET', 'HEAD'].includes(request.method)) {
            const text = await request.text();
            body = text ? (request.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text) : null;
        }
        const path = url.pathname.replace(/^\/api(?=\/|$)/, '') + url.search;
        const key = requestKey({ method: request.method, path, body });
        const response = url.origin === 'http://preview.local' && url.pathname.startsWith('/api/') ? responses.get(key) : null;
        if (!response) {
            const message = `Unrecorded request: ${request.method} ${url.pathname}${url.search}`;
            onMiss(message);
            throw new Error(message);
        }
        if (request.signal.aborted) throw request.signal.reason;
        return new Response(typeof response.body === 'string' ? response.body : JSON.stringify(response.body), {
            status: response.status, headers: response.headers,
        });
    };
}

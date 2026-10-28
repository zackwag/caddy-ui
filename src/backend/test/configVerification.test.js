import { once } from 'node:events';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { caddyAdapt } from '../src/caddy.js';
import { verifyLiveConfig, verifyLiveObject, verifyLiveObjectRemoved } from '../src/configVerification.js';
import logger from '../src/logger.js';

// A stand-in admin API over real HTTP, so readback runs through the real
// caddy.js helpers. Each test sets how it responds.
let respond;
const server = createServer((req, res) => respond(req, res));
let instance;

beforeAll(async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    instance = { id: 'default', adminUrl: `http://127.0.0.1:${server.address().port}` };
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
});

const reply = (status, body, type = 'application/json') => (req, res) => {
    req.resume();
    res.writeHead(status, { 'Content-Type': type });
    res.end(body);
};

// Sends headers and part of a JSON body, then stalls. The 10s deadline is
// replaced with one that fires shortly after, so the test needn't wait for it.
function stallBody(req, res) {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"result":');
}
function shortDeadline() {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    setTimeout(() => deadline.abort(new DOMException('Readback deadline', 'TimeoutError')), 50);
}

describe('readback deadline', () => {
    it('covers a running-config body that stalls after its headers', async () => {
        shortDeadline();
        respond = stallBody;
        expect(await verifyLiveConfig(instance, async () => ({}))).toBe('unavailable');
    });

    it('covers an adaptation body that stalls after its headers', async () => {
        shortDeadline();
        respond = stallBody;
        await expect(caddyAdapt('example.com {\n}\n', instance.adminUrl)).rejects.toMatchObject({ name: 'TimeoutError' });
    });
});

describe('unreadable readback', () => {
    const html = reply(200, '<html>proxy error</html>', 'text/html');

    it('reports a non-JSON body as unavailable, not as a verified removal', async () => {
        respond = html;
        expect(await verifyLiveObjectRemoved(instance, 'route-1')).toBe('unavailable');
    });

    it('reports a non-JSON body as unavailable, not as a running-config mismatch', async () => {
        respond = html;
        expect(await verifyLiveConfig(instance, async () => ({}))).toBe('unavailable');
    });

    it('reports a JSON value that is not an object or null as unavailable', async () => {
        respond = reply(200, '[]');
        expect(await verifyLiveObjectRemoved(instance, 'route-1')).toBe('unavailable');
    });

    it.each([
        ['no HTTP servers', 'null', 'verified'],
        ['an empty server map', '{}', 'verified'],
        ['the route still present', JSON.stringify({ srv0: { routes: [{ '@id': 'route-1' }] } }), 'mismatch'],
    ])('still checks a removal against %s', async (name, body, expected) => {
        respond = reply(200, body);
        expect(await verifyLiveObjectRemoved(instance, 'route-1')).toBe(expected);
    });
});

describe('unknown @id', () => {
    it('reports an object the admin API does not have as a mismatch', async () => {
        const error = vi.spyOn(logger, 'error');
        respond = reply(404, JSON.stringify({ error: "unknown object ID 'route-1'" }));
        expect(await verifyLiveObject(instance, 'route-1', { '@id': 'route-1' })).toBe('mismatch');
        expect(error).not.toHaveBeenCalled();
    });
});

describe('readback logging', () => {
    it('never logs the body of an error response', async () => {
        const secret = 'token-' + randomUUID();
        const calls = ['debug', 'info', 'warn', 'error'].map(level => vi.spyOn(logger, level));
        respond = reply(500, JSON.stringify({ error: `loading config: ${secret}` }));
        expect(await verifyLiveConfig(instance, async () => ({}))).toBe('unavailable');
        expect(await verifyLiveObject(instance, 'route-1', {})).toBe('unavailable');
        expect(await verifyLiveObjectRemoved(instance, 'route-1')).toBe('unavailable');
        const logged = JSON.stringify(calls.map(spy => spy.mock.calls));
        expect(logged).toContain('Configuration readback unavailable');
        expect(logged).not.toContain(secret);
    });
});

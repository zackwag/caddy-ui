import { createServer } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('dns', () => ({ promises: { lookup } }));

const { isBlockedAddress, resolveWebhookDestination, sendWebhook } = await import('../src/webhookTransport.js');

describe('isBlockedAddress', () => {
    it.each([
        '10.0.0.5', '172.18.0.5', '192.168.1.50', '100.100.1.1', 'fd00::5', '93.184.216.34', '2606:4700::1111',
    ])('allows %s', address => {
        expect(isBlockedAddress(address)).toBe(false);
    });

    it.each([
        '127.0.0.1', '127.8.8.8', '0.0.0.0', '169.254.169.254', '224.0.0.1', '255.255.255.255',
        '::', '::1', 'fe80::1', 'febf::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', 'not-an-ip',
    ])('blocks %s', address => {
        expect(isBlockedAddress(address)).toBe(true);
    });
});

describe('resolveWebhookDestination', () => {
    beforeEach(() => {
        lookup.mockReset();
    });

    it('allows a Docker service name that resolves to a private address', async () => {
        lookup.mockResolvedValue([{ address: '172.18.0.5', family: 4 }]);
        const destination = await resolveWebhookDestination('http://ntfy/caddy-alerts');
        expect(destination).toMatchObject({ address: '172.18.0.5', family: 4 });
        expect(destination.url.href).toBe('http://ntfy/caddy-alerts');
    });

    it('allows .internal names', async () => {
        lookup.mockResolvedValue([{ address: '192.168.1.50', family: 4 }]);
        await expect(resolveWebhookDestination('https://ntfy.home.internal/topic')).resolves.toMatchObject({ address: '192.168.1.50' });
    });

    it('rejects a host if any answer is blocked', async () => {
        lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]);
        await expect(resolveWebhookDestination('https://mixed.example.com/')).rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
    });

    it('rejects metadata hosts by name and by address', async () => {
        await expect(resolveWebhookDestination('http://metadata.google.internal/')).rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
        await expect(resolveWebhookDestination('http://169.254.169.254/latest/')).rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
    });

    it.each(['http://localhost:8080/', 'http://app.localhost/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/'])(
        'rejects loopback destination %s', async url => {
            await expect(resolveWebhookDestination(url)).rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
        },
    );

    it('checks IP literals without a DNS lookup, including bracketed IPv6', async () => {
        await expect(resolveWebhookDestination('http://[fd00::5]:8080/topic')).resolves.toMatchObject({ address: 'fd00::5', family: 6 });
        await expect(resolveWebhookDestination('http://192.168.1.50/topic')).resolves.toMatchObject({ address: '192.168.1.50', family: 4 });
        expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects other protocols and strips credentials and fragments', async () => {
        await expect(resolveWebhookDestination('ftp://example.com/')).rejects.toThrow('must use http or https');
        const destination = await resolveWebhookDestination('http://user:secret@192.168.1.50/topic#frag');
        expect(destination.url.href).toBe('http://192.168.1.50/topic');
    });
});

describe('sendWebhook', () => {
    let server;
    let port;
    let handler;
    const received = [];

    beforeEach(async () => {
        received.length = 0;
        handler = (req, res) => res.end('ok');
        server = createServer((req, res) => {
            const chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
                handler(req, res);
            });
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
    });

    afterEach(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });

    // Pin a name that doesn't resolve to the local test server, as the default resolver
    // pins a checked address.
    const pinned = () => async url => ({ url: new URL(url), address: '127.0.0.1', family: 4 });

    it('connects to the pinned address while keeping the original host', async () => {
        await sendWebhook(`http://ntfy.test:${port}/caddy-alerts`, {
            name: 'ntfy', headers: { Title: 'Alert' }, body: 'Something happened',
        }, { resolveDestination: pinned() });

        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({ method: 'POST', url: '/caddy-alerts', body: 'Something happened' });
        expect(received[0].headers.host).toBe(`ntfy.test:${port}`);
        expect(received[0].headers.title).toBe('Alert');
        expect(received[0].headers['content-length']).toBe(String(Buffer.byteLength('Something happened')));
    });

    it('uses the requested method', async () => {
        await sendWebhook(`http://hook.test:${port}/`, { name: 'Custom webhook', method: 'PUT', body: '{}' }, { resolveDestination: pinned() });
        expect(received[0].method).toBe('PUT');
    });

    it('does not follow redirects', async () => {
        handler = (req, res) => {
            res.writeHead(302, { Location: `http://127.0.0.1:${port}/elsewhere` });
            res.end();
        };
        await expect(sendWebhook(`http://ntfy.test:${port}/topic`, { name: 'ntfy', body: 'x' }, { resolveDestination: pinned() }))
            .rejects.toThrow('ntfy responded 302; redirects are not followed');
        expect(received.map(r => r.url)).toEqual(['/topic']);
    });

    it('truncates the response body in errors', async () => {
        handler = (req, res) => {
            res.writeHead(500);
            res.end('e'.repeat(5000));
        };
        const error = await sendWebhook(`http://ntfy.test:${port}/topic`, { name: 'ntfy', body: 'x' }, { resolveDestination: pinned() })
            .catch(err => err);
        expect(error.message).toBe(`ntfy responded 500: ${'e'.repeat(200)}`);
    });

    it('rejects oversized responses', async () => {
        handler = (req, res) => res.end('x'.repeat(65 * 1024));
        await expect(sendWebhook(`http://ntfy.test:${port}/topic`, { name: 'ntfy', body: 'x' }, { resolveDestination: pinned() }))
            .rejects.toThrow('ntfy response exceeds size limit');
    });

    it('times out a destination that never answers', async () => {
        handler = () => {};
        await expect(sendWebhook(`http://ntfy.test:${port}/topic`, { name: 'ntfy', body: 'x' }, { resolveDestination: pinned(), timeoutMs: 50 }))
            .rejects.toThrow('ntfy request timed out');
    });

    it('does not connect when the destination is blocked', async () => {
        await expect(sendWebhook(`http://127.0.0.1:${port}/topic`, { name: 'ntfy', body: 'x' }))
            .rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
        expect(received).toHaveLength(0);
    });
});

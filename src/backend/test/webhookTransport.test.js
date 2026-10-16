import http, { createServer } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('dns', () => ({ promises: { lookup } }));

const { isBlockedAddress, resolveWebhookDestination, sendWebhook } = await import('../src/webhookTransport.js');

describe('isBlockedAddress', () => {
    it.each([
        '10.0.0.5', '172.18.0.5', '192.168.1.50', '100.100.1.1', 'fd00::5', '93.184.216.34', '2606:4700::1111',
        '100.100.100.199', '100.100.100.201', 'fd00:ec2::253', 'fd20:ce::255',
    ])('allows %s', address => {
        expect(isBlockedAddress(address)).toBe(false);
    });

    it.each([
        '127.0.0.1', '127.8.8.8', '0.0.0.0', '169.254.169.254', '224.0.0.1', '255.255.255.255',
        '::', '::1', 'fe80::1', 'febf::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', 'not-an-ip',
        'fd00:ec2::254', 'fd20:ce::254', '100.100.100.200', '::ffff:100.100.100.200', '::ffff:6464:64c8',
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

    it('retains all validated DNS answers in order', async () => {
        const addresses = [{ address: 'fd00::5', family: 6 }, { address: '172.18.0.5', family: 4 }];
        lookup.mockResolvedValue(addresses);
        await expect(resolveWebhookDestination('http://ntfy.test/topic')).resolves.toMatchObject({ addresses });
        expect(lookup).toHaveBeenCalledTimes(1);
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

    it.each([
        'http://[fd00:ec2::254]/latest/meta-data/',
        'http://[fd20:ce::254]/computeMetadata/v1/',
        'http://100.100.100.200/latest/meta-data/',
        'http://[::ffff:100.100.100.200]/latest/meta-data/',
    ])('rejects private-range metadata literal %s without DNS', async url => {
        await expect(resolveWebhookDestination(url)).rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
        expect(lookup).not.toHaveBeenCalled();
    });

    it.each(['fd00:ec2::254', 'fd20:ce::254', '100.100.100.200', '::ffff:100.100.100.200'])(
        'rejects a hostname resolving to metadata address %s', async address => {
            lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
            await expect(resolveWebhookDestination('http://metadata-alias.test/'))
                .rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
        },
    );

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

    it('falls back from an unavailable IPv6 address to IPv4 without resolving again', async () => {
        const resolveDestination = vi.fn(async raw => ({
            url: new URL(raw), address: '::1', family: 6,
            addresses: [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }],
        }));
        await sendWebhook(`http://unresolvable.test:${port}/topic`, { name: 'ntfy', body: 'once' }, { resolveDestination });
        expect(resolveDestination).toHaveBeenCalledTimes(1);
        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({ body: 'once', headers: { host: `unresolvable.test:${port}` } });
    });

    it('rejects a mixed safe/blocked DNS answer set before opening a connection', async () => {
        lookup.mockResolvedValue([{ address: '172.18.0.5', family: 4 }, { address: '::1', family: 6 }]);
        await expect(sendWebhook(`http://mixed.test:${port}/`, { name: 'ntfy', body: 'x' }))
            .rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(received).toHaveLength(0);
    });

    it.each(['response', 'reset'])('does not retry a POST after delivery followed by a %s failure', async failure => {
        handler = (req, res) => {
            if (failure === 'reset') req.socket.destroy();
            else {
                res.writeHead(500);
                res.end('failed');
            }
        };
        let fallbackRequests = 0;
        const alternate = createServer((req, res) => {
            fallbackRequests++;
            req.resume();
            res.end('unexpected retry');
        });
        await new Promise((resolve, reject) => {
            alternate.once('error', reject);
            alternate.listen(port, '127.0.0.2', resolve);
        });
        try {
            const resolveDestination = vi.fn(async raw => ({
                url: new URL(raw), address: '127.0.0.1', family: 4,
                addresses: [{ address: '127.0.0.1', family: 4 }, { address: '127.0.0.2', family: 4 }],
            }));
            await expect(sendWebhook(`http://ntfy.test:${port}/topic`, { name: 'ntfy', body: 'once' }, { resolveDestination }))
                .rejects.toThrow(failure === 'reset' ? 'socket hang up' : 'ntfy responded 500');
            expect(resolveDestination).toHaveBeenCalledTimes(1);
            expect(received).toHaveLength(1);
            expect(fallbackRequests).toBe(0);
        } finally {
            alternate.closeAllConnections();
            await new Promise(resolve => alternate.close(resolve));
        }
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

    it.each(['resolve', 'reject'])('bounds stalled DNS and ignores a late %s without opening a request', async settlement => {
        vi.useFakeTimers();
        const request = vi.spyOn(http, 'request');
        let settle;
        const result = vi.fn();
        const pending = sendWebhook(`http://late.test:${port}/topic`, { name: 'ntfy', body: 'x' }, {
            resolveDestination: raw => new Promise((resolve, reject) => {
                settle = () => settlement === 'resolve'
                    ? resolve({ url: new URL(raw), address: '127.0.0.1', family: 4 })
                    : reject(new Error('late DNS failure'));
            }),
            timeoutMs: 100,
        });
        // Handle rejection before advancing the clock, including late DNS failures.
        void pending.then(result, result);
        try {
            await vi.advanceTimersByTimeAsync(100);
            expect(result).toHaveBeenCalledWith(expect.objectContaining({ message: 'ntfy request timed out' }));
            expect(request).not.toHaveBeenCalled();
            settle();
            await vi.advanceTimersByTimeAsync(0);
            expect(result).toHaveBeenCalledTimes(1);
            expect(request).not.toHaveBeenCalled();
            expect(received).toHaveLength(0);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            // Settle on failure too, so the test itself never leaves a lookup pending.
            settle();
            request.mockRestore();
            vi.useRealTimers();
        }
    });

    it('uses the remaining deadline after DNS rather than starting another timeout', async () => {
        vi.useFakeTimers();
        let finishDns;
        let accepted;
        const requestReceived = new Promise(resolve => { accepted = resolve; });
        handler = () => accepted(); // Keep the response open after DNS completes.
        const result = vi.fn();
        const pending = sendWebhook(`http://slow.test:${port}/topic`, { name: 'ntfy', body: 'x' }, {
            resolveDestination: raw => new Promise(resolve => {
                finishDns = () => resolve({ url: new URL(raw), address: '127.0.0.1', family: 4 });
            }),
            timeoutMs: 100,
        });
        void pending.then(result, result);
        try {
            await vi.advanceTimersByTimeAsync(60);
            finishDns();
            await requestReceived;
            await vi.advanceTimersByTimeAsync(40);
            expect(result).toHaveBeenCalledWith(expect.objectContaining({ message: 'ntfy request timed out' }));
            expect(received).toHaveLength(1);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            finishDns();
            vi.useRealTimers();
        }
    });

    it.each(['success', 'response error', 'resolution error'])('cleans up the deadline after %s', async outcome => {
        vi.useFakeTimers();
        handler = (req, res) => {
            res.writeHead(outcome === 'response error' ? 500 : 200);
            res.end('done');
        };
        const resolveDestination = outcome === 'resolution error'
            ? () => { throw new Error('resolution failed'); }
            : pinned();
        try {
            const pending = sendWebhook(`http://ntfy.test:${port}/topic`, { name: 'ntfy', body: 'x' }, { resolveDestination });
            if (outcome === 'success') await pending;
            else await expect(pending).rejects.toThrow(outcome === 'response error' ? 'ntfy responded 500' : 'resolution failed');
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not connect when the destination is blocked', async () => {
        await expect(sendWebhook(`http://127.0.0.1:${port}/topic`, { name: 'ntfy', body: 'x' }))
            .rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
        expect(received).toHaveLength(0);
    });
});

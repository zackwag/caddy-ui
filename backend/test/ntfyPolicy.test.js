import { describe, expect, it, vi } from 'vitest';
import { createNtfyPolicy } from '../src/ntfyPolicy.js';

const topic = 'https://ntfy.internal/alerts?token=secret';
const record = address => ({ address, family: address.includes(':') ? 6 : 4 });
function fixture({ urls = [topic], cidrs = ['192.168.178.0/24'], addresses = ['192.168.178.5'], env = {} } = {}) {
    const lookup = vi.fn().mockResolvedValue(addresses.map(record));
    const log = { debug: vi.fn(), warn: vi.fn() };
    const resolve = createNtfyPolicy({ env: {
        CADDY_UI_NTFY_ALLOWED_INTERNAL_URLS: JSON.stringify(urls),
        CADDY_UI_NTFY_ALLOWED_INTERNAL_NETWORKS: JSON.stringify(cidrs), ...env,
    }, lookup, log });
    return { resolve, lookup, log };
}

describe('ntfy operator policy', () => {
    it('allows an exact normalized topic URL inside the approved subnet', async () => {
        const { resolve } = fixture();
        expect(await resolve('https://NTFY.internal:443/alerts?token=secret')).toMatchObject({ address: '192.168.178.5', family: 4 });
    });

    it.each([
        'http://ntfy.internal/alerts?token=secret', 'https://ntfy.internal:8443/alerts?token=secret',
        'https://ntfy.internal/other?token=secret', 'https://ntfy.internal/alerts?token=other',
        'https://other.internal/alerts?token=secret',
    ])('does not extend the URL exception to %s', async url => {
        await expect(fixture().resolve(url)).rejects.toThrow('internal_url_not_approved');
    });

    it('identifies internal policy denials separately from DNS failures', async () => {
        await expect(fixture({ urls: [], addresses: ['127.0.0.1'] }).resolve(topic)).rejects.toMatchObject({
            code: 'NTFY_DESTINATION_BLOCKED', status: 403, context: { reason: 'internal_url_not_approved' },
        });
        await expect(fixture({ addresses: ['127.0.0.1'] }).resolve(topic)).rejects.toMatchObject({
            code: 'NTFY_DESTINATION_BLOCKED', context: { reason: 'outside_internal_policy' },
        });
        const { resolve, lookup } = fixture();
        lookup.mockRejectedValueOnce(new Error('DNS failed'));
        await expect(resolve(topic)).rejects.not.toHaveProperty('code', 'NTFY_DESTINATION_BLOCKED');
    });

    it('requires both the URL and the network permission', async () => {
        await expect(fixture({ cidrs: [] }).resolve(topic)).rejects.toThrow('outside_internal_policy');
        await expect(fixture({ urls: [] }).resolve(topic)).rejects.toThrow('internal_url_not_approved');
    });

    it('does not let a listed endpoint escape its subnet by moving to a public IP', async () => {
        await expect(fixture({ addresses: ['93.184.216.34'] }).resolve(topic)).rejects.toThrow('outside_internal_policy');
    });

    it('keeps ordinary public endpoints usable without an operator exception', async () => {
        const { resolve } = fixture({ urls: [], cidrs: [], addresses: ['93.184.216.34'] });
        expect(await resolve('https://ntfy.sh/topic')).toMatchObject({ address: '93.184.216.34' });
    });

    it('rejects a mixed public/private DNS answer for an unlisted endpoint', async () => {
        await expect(fixture({ urls: [], addresses: ['93.184.216.34', '10.0.0.1'] }).resolve('https://ntfy.sh/topic'))
            .rejects.toThrow('internal_url_not_approved');
    });

    it.each(['::1', '::ffff:127.0.0.1', '::ffff:192.168.178.5', 'fe90::1', 'fd00::1', '::', 'ff02::1'])('blocks non-public %s by default', async address => {
        await expect(fixture({ urls: [], addresses: [address] }).resolve('https://ntfy.sh/topic'))
            .rejects.toThrow('internal_url_not_approved');
    });

    it('uses an approved A result even when the AAAA result is outside policy', async () => {
        const { resolve } = fixture({ addresses: ['2606:4700:4700::1111', '192.168.178.5'] });
        expect(await resolve(topic)).toMatchObject({ address: '192.168.178.5', family: 4 });
    });

    it('supports IPv6 CIDRs and independently scoped IPv4 and IPv6 /0 policies', async () => {
        expect(await fixture({ cidrs: ['fd12:3456::/32'], addresses: ['fd12:3456::2'] }).resolve(topic)).toMatchObject({ family: 6 });
        expect(await fixture({ cidrs: ['0.0.0.0/0'] }).resolve(topic)).toMatchObject({ family: 4 });
        expect(await fixture({ cidrs: ['::/0'], addresses: ['fd12::2'] }).resolve(topic)).toMatchObject({ family: 6 });
        await expect(fixture({ cidrs: ['::/0'] }).resolve(topic)).rejects.toThrow('outside_internal_policy');
        await expect(fixture({ cidrs: ['0.0.0.0/0'], addresses: ['fd12::2'] }).resolve(topic)).rejects.toThrow('outside_internal_policy');
    });

    it('normalizes mapped IPv6 before checking IPv4 CIDRs and logs', async () => {
        const { resolve } = fixture({ addresses: ['::ffff:c0a8:b205'] });
        expect(await resolve(topic)).toMatchObject({ address: '192.168.178.5', family: 4 });
    });

    it.each([
        ['127.0.0.2', 'CADDY_UI_NTFY_ALLOW_LOOPBACK'], ['::1', 'CADDY_UI_NTFY_ALLOW_LOOPBACK'],
        ['::ffff:127.0.0.1', 'CADDY_UI_NTFY_ALLOW_LOOPBACK'],
        ['169.254.169.254', 'CADDY_UI_NTFY_ALLOW_LINK_LOCAL'], ['fe90::1', 'CADDY_UI_NTFY_ALLOW_LINK_LOCAL'],
    ])('requires a separate explicit opt-in for %s', async (address, flag) => {
        const options = { cidrs: ['0.0.0.0/0', '::/0'], addresses: [address] };
        await expect(fixture(options).resolve(topic)).rejects.toThrow('outside_internal_policy');
        expect(await fixture({ ...options, env: { [flag]: 'true' } }).resolve(topic)).toBeDefined();
        await expect(fixture({ ...options, cidrs: [], env: { [flag]: 'true' } }).resolve(topic)).rejects.toThrow('outside_internal_policy');
    });

    it.each(['0.0.0.0', '224.0.0.1', '255.255.255.255', '::', 'ff02::1'])('never dials an unspecified/multicast/reserved target %s', async address => {
        await expect(fixture({ cidrs: ['0.0.0.0/0', '::/0'], addresses: [address], env: {
            CADDY_UI_NTFY_ALLOW_LOOPBACK: 'true', CADDY_UI_NTFY_ALLOW_LINK_LOCAL: 'true',
        } }).resolve(topic)).rejects.toThrow('outside_internal_policy');
    });

    it('resolves literals without DNS, including bracketed IPv6', async () => {
        const url = 'https://[fd12::2]/topic';
        const { resolve, lookup } = fixture({ urls: [url], cidrs: ['fd12::/16'] });
        expect(await resolve(url)).toMatchObject({ address: 'fd12::2', family: 6 });
        expect(lookup).not.toHaveBeenCalled();
    });

    it.each(['not a URL', 'file:///etc/passwd', 'https://user:password@ntfy.sh/topic', 'https://ntfy.sh/topic#fragment'])('rejects invalid or ambiguous endpoint %s', async url => {
        await expect(fixture().resolve(url)).rejects.toThrow(/Invalid ntfy URL|must use HTTP/);
    });

    it.each([
        { CADDY_UI_NTFY_ALLOWED_INTERNAL_URLS: 'ntfy.internal' },
        { CADDY_UI_NTFY_ALLOWED_INTERNAL_URLS: '["file:///etc/passwd"]' },
        { CADDY_UI_NTFY_ALLOWED_INTERNAL_NETWORKS: '["192.168.1.1"]' },
        { CADDY_UI_NTFY_ALLOWED_INTERNAL_NETWORKS: '["192.168.1.1/33"]' },
        { CADDY_UI_NTFY_ALLOWED_INTERNAL_NETWORKS: '["::/129"]' },
        { CADDY_UI_NTFY_ALLOWED_INTERNAL_NETWORKS: '["::ffff:127.0.0.1/128"]' },
        { CADDY_UI_NTFY_ALLOWED_INTERNAL_NETWORKS: '[42]' },
        { CADDY_UI_NTFY_ALLOW_LOOPBACK: 'yes' },
        { CADDY_UI_NTFY_ALLOW_LINK_LOCAL: '1' },
    ])('fails closed on malformed operator configuration %j', env => {
        expect(() => fixture({ env })).toThrow(/CADDY_UI_NTFY_/);
    });

    it('records allowed and denied address changes without logging topic/query secrets', async () => {
        const { resolve, lookup, log } = fixture();
        await resolve(topic);
        lookup.mockResolvedValueOnce([record('192.168.178.6')]);
        await resolve(topic);
        expect(log.warn).toHaveBeenLastCalledWith('ntfy destination addresses changed', expect.objectContaining({
            event: 'ntfy.addresses_changed', previousAddresses: ['192.168.178.5'], addresses: ['192.168.178.6'], decision: 'allowed',
        }));
        lookup.mockResolvedValueOnce([record('10.0.0.1')]);
        await expect(resolve(topic)).rejects.toThrow('outside_internal_policy');
        expect(log.warn).toHaveBeenLastCalledWith('ntfy destination blocked', expect.objectContaining({ decision: 'blocked', reason: 'outside_internal_policy' }));
        expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(/alerts|secret|token/);
        // A previous allowed result never authorizes a later disallowed one.
        await resolve(topic);
        expect(lookup).toHaveBeenCalledTimes(4);
    });

    it('bounds a stalled DNS resolver', async () => {
        const resolve = createNtfyPolicy({ env: {}, lookup: () => new Promise(() => {}),
            lookupTimeoutMs: 20, log: { warn: vi.fn(), debug: vi.fn() } });
        await expect(resolve('https://ntfy.sh/topic')).rejects.toThrow('dns_lookup_failed');
    });

    it('logs DNS failures and malformed/empty answers without exposing resolver errors', async () => {
        const { resolve, lookup, log } = fixture();
        lookup.mockRejectedValueOnce(new Error('secret resolver detail'));
        await expect(resolve(topic)).rejects.toThrow('dns_lookup_failed');
        lookup.mockResolvedValueOnce([]);
        await expect(resolve(topic)).rejects.toThrow('invalid_or_empty_dns_answer');
        lookup.mockResolvedValueOnce([record('garbage')]);
        await expect(resolve(topic)).rejects.toThrow('invalid_or_empty_dns_answer');
        expect(JSON.stringify(log.warn.mock.calls)).not.toContain('secret resolver detail');
    });
});

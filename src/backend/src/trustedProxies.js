import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import proxyaddr from 'proxy-addr';

// An explicit address list avoids trusting a caller just because it is one hop
// away. In particular, a directly exposed backend must ignore forwarded IPs.
export function parseTrustedProxies(value = '') {
    if (!value.trim()) return false;
    const addresses = value.split(',').map(address => address.trim());
    for (const cidr of addresses) {
        const [address, prefix, ...extra] = cidr.split('/');
        const family = isIP(address);
        if (!family || extra.length || (prefix !== undefined && (!/^[1-9]\d*$/.test(prefix)
            || Number(prefix) > (family === 4 ? 32 : 128)
            || (family === 6 && ipaddr.parse(address).isIPv4MappedAddress() && Number(prefix) < 96)))) {
            throw new Error('CADDY_UI_TRUSTED_PROXIES must contain comma-separated IP addresses or CIDRs');
        }
    }
    try { proxyaddr.compile(addresses); }
    catch (cause) { throw new Error('CADDY_UI_TRUSTED_PROXIES contains an invalid proxy address or CIDR', { cause }); }
    return addresses;
}

// Only the named bundled frontend is discovered, never an entire Docker subnet
// or a hop count. An explicit value overrides discovery; blank disables trust.
export async function createProxyTrust(value, { resolve = lookup, refreshMs = 30_000 } = {}) {
    if (value !== undefined) {
        const addresses = parseTrustedProxies(value);
        return { trust: addresses ? proxyaddr.compile(addresses) : () => false, close() {} };
    }
    let trusts = () => false;
    let closed = false;
    let pending;
    const refresh = () => pending ??= (async () => {
        try {
            const addresses = await resolve('caddy-ui-frontend', { all: true });
            if (!closed) trusts = proxyaddr.compile(addresses.map(({ address }) => address));
        } catch {
            // Fail closed on lookup failure, including frontend recreation.
            trusts = () => false;
        }
    })().finally(() => { pending = undefined; });
    await refresh();
    const timer = setInterval(refresh, refreshMs);
    timer.unref();
    return {
        // nginx emits exactly one verified client address. Do not extend its
        // trust to another occurrence of that address inside a supplied chain.
        trust: (address, hop) => hop === 0 && trusts(address),
        close() { closed = true; clearInterval(timer); trusts = () => false; },
    };
}

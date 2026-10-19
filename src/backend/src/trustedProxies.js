import { isIP } from 'node:net';

// An explicit address list avoids trusting a caller just because it is one hop
// away. In particular, a directly exposed backend must ignore forwarded IPs.
export function parseTrustedProxies(value = '') {
    if (!value.trim()) return false;
    const addresses = value.split(',').map(address => address.trim());
    for (const cidr of addresses) {
        const [address, prefix, ...extra] = cidr.split('/');
        const family = isIP(address);
        if (!family || extra.length || (prefix !== undefined && (!/^(0|[1-9]\d*)$/.test(prefix)
            || Number(prefix) > (family === 4 ? 32 : 128)))) {
            throw new Error('CADDY_UI_TRUSTED_PROXIES must contain comma-separated IP addresses or CIDRs');
        }
    }
    return addresses;
}

import { createHash } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import logger from './logger.js';
import { AppError } from './AppError.js';

function normalizeAddress(address) {
    if (typeof address !== 'string' || !isIP(address) || address.includes('%')) return null;
    if (isIP(address) === 4) return { address, family: 4 };
    const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(normalized);
    if (mapped) {
        const high = parseInt(mapped[1], 16);
        const low = parseInt(mapped[2], 16);
        return { address: [high >> 8, high & 255, low >> 8, low & 255].join('.'), family: 4 };
    }
    return { address: normalized, family: 6 };
}

function networks(cidrs) {
    // Separate lists: Node's IPv6 ::/0 also matches IPv4-mapped addresses.
    const lists = { 4: new BlockList(), 6: new BlockList() };
    for (const cidr of cidrs) {
        const parts = typeof cidr === 'string' ? cidr.split('/') : [];
        const record = normalizeAddress(parts[0]);
        const prefix = Number(parts[1]);
        if (parts.length !== 2 || !record || isIP(parts[0]) !== record.family
            || !/^\d+$/.test(parts[1]) || prefix > (record.family === 4 ? 32 : 128)) {
            throw new Error('Expected IPv4 or IPv6 CIDR notation');
        }
        lists[record.family].addSubnet(record.address, prefix, record.family === 4 ? 'ipv4' : 'ipv6');
    }
    return record => lists[record.family].check(record.address, record.family === 4 ? 'ipv4' : 'ipv6');
}

const loopback = networks(['127.0.0.0/8', '::1/128']);
const linkLocal = networks(['169.254.0.0/16', 'fe80::/10']);
const unusable = networks(['0.0.0.0/8', '224.0.0.0/3', '::/128', 'ff00::/8']);
const privateV4 = networks(['10.0.0.0/8', '100.64.0.0/10', '172.16.0.0/12', '192.168.0.0/16',
    '192.0.0.0/24', '192.0.2.0/24', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24']);
const globalV6 = networks(['2000::/3']);
const documentationV6 = networks(['2001:db8::/32']);
const isPublic = record => !unusable(record) && !loopback(record) && !linkLocal(record)
    && (record.family === 4 ? !privateV4(record) : globalV6(record) && !documentationV6(record));

function parseUrl(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Invalid ntfy URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.includes('#')) {
        throw new Error('ntfy URL must use HTTP(S), without credentials or a fragment');
    }
    return url;
}

function arraySetting(env, name) {
    if (!env[name]) return [];
    try {
        const value = JSON.parse(env[name]);
        if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error();
        return value;
    } catch { throw new Error(`${name} must be a JSON array of strings`); }
}

function flagSetting(env, name) {
    if (!env[name] || env[name] === 'false') return false;
    if (env[name] === 'true') return true;
    throw new Error(`${name} must be true or false`);
}

/** Operator policy is independent of the editable Notifications configuration. */
export function createNtfyPolicy({ env = process.env, lookup = dns.lookup, log = logger, lookupTimeoutMs = 5_000 } = {}) {
    const urlSetting = 'CADDY_UI_NTFY_ALLOWED_INTERNAL_URLS';
    const networkSetting = 'CADDY_UI_NTFY_ALLOWED_INTERNAL_NETWORKS';
    let urls, allowed;
    try { urls = new Set(arraySetting(env, urlSetting).map(value => parseUrl(value).href)); }
    catch { throw new Error(`${urlSetting} must be a JSON array of valid HTTP(S) topic URLs without credentials or fragments`); }
    try { allowed = networks(arraySetting(env, networkSetting)); }
    catch { throw new Error(`${networkSetting} must be a JSON array of IPv4 or IPv6 CIDRs`); }
    const allowLoopback = flagSetting(env, 'CADDY_UI_NTFY_ALLOW_LOOPBACK');
    const allowLinkLocal = flagSetting(env, 'CADDY_UI_NTFY_ALLOW_LINK_LOCAL');
    const observations = new Map();

    return async function resolveDestination(value) {
        const url = parseUrl(value);
        const hostname = url.hostname.replace(/^\[|\]$/g, '');
        const endpointId = createHash('sha256').update(url.href).digest('hex').slice(0, 16);
        const listed = urls.has(url.href);
        let records = [];
        let reason;
        try {
            const literal = normalizeAddress(hostname);
            let answers;
            if (literal) answers = [literal];
            else {
                let timer;
                try {
                    answers = await Promise.race([
                        lookup(hostname, { all: true, verbatim: true }),
                        new Promise((resolve, reject) => {
                            timer = setTimeout(() => reject(new Error('DNS lookup timed out')), lookupTimeoutMs);
                        }),
                    ]);
                } finally { clearTimeout(timer); }
            }
            records = answers.map(answer => normalizeAddress(answer.address));
            if (!records.length || records.some(record => !record)) reason = 'invalid_or_empty_dns_answer';
        } catch { reason = 'dns_lookup_failed'; }
        const addresses = [...new Set(records.filter(Boolean).map(record => record.address))].sort();
        const eligible = record => !unusable(record) && allowed(record)
            && (!loopback(record) || allowLoopback) && (!linkLocal(record) || allowLinkLocal);
        let selected;
        if (!reason) {
            if (listed) {
                selected = records.find(eligible);
                if (!selected) reason = 'outside_internal_policy';
            } else {
                const internalName = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.internal');
                if (internalName || records.some(record => !isPublic(record))) reason = 'internal_url_not_approved';
                else selected = records[0];
            }
        }
        const decision = reason ? 'blocked' : 'allowed';
        const previous = observations.get(endpointId);
        const meta = { endpointId, hostname, addresses, decision, reason: reason || (listed ? 'internal_policy' : 'public_destination') };
        if (previous && JSON.stringify(previous) !== JSON.stringify(addresses)) {
            log.warn('ntfy destination addresses changed', { ...meta, event: 'ntfy.addresses_changed', previousAddresses: previous });
        }
        // Observations never authorize delivery; cap memory even with many edited URLs.
        observations.delete(endpointId);
        observations.set(endpointId, addresses);
        if (observations.size > 256) observations.delete(observations.keys().next().value);
        if (reason) {
            log.warn('ntfy destination blocked', { ...meta, event: 'ntfy.destination_blocked' });
            if (reason === 'internal_url_not_approved' || reason === 'outside_internal_policy') {
                throw new AppError('NTFY_DESTINATION_BLOCKED', {
                    message: `ntfy destination blocked: ${reason}`, context: { reason, endpointId },
                });
            }
            throw new Error(`ntfy destination blocked: ${reason}`);
        }
        log.debug('ntfy destination approved', { ...meta, event: 'ntfy.destination_approved', selectedAddress: selected.address });
        return { url, hostname, ...selected };
    };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { containerNetworkProbe, waitForContainerNetwork } from './stack.mjs';

function probeFixture({ visible = true, vanished = false, disabled = '0', generation = '0', flags = '80' } = {}) {
    let peerCalls = 0;
    const files = {
        '/sys/class/net/veth-owned/ifindex': '31',
        '/proc/sys/net/ipv6/conf/veth-owned/disable_ipv6': disabled,
        '/proc/sys/net/ipv6/conf/veth-owned/addr_gen_mode': generation,
        '/proc/net/if_inet6': `fe800000000000000000000000000001 1f 40 20 ${flags} veth-owned`,
    };
    const probe = containerNetworkProbe('owned-container', { platform: 'linux', peer: async () => { peerCalls++; return 31; },
        list: async () => visible ? ['lo', ...(vanished ? ['veth-removed'] : []), 'veth-owned'] : ['lo'],
        read: async path => {
            if (path.includes('veth-removed')) throw Object.assign(new Error('interface removed'), { code: 'ENOENT' });
            assert.ok(Object.hasOwn(files, path), path); return files[path];
        } });
    return { probe, files, peerCalls: () => peerCalls };
}

test('owned IPv6 address must finish duplicate-address detection before browser startup', async () => {
    const fixture = probeFixture({ flags: 'c0' });
    let polls = 0;
    const ready = await waitForContainerNetwork('owned-container', { probe: async signal => {
        polls++;
        if (polls === 2) fixture.files['/proc/net/if_inet6'] = fixture.files['/proc/net/if_inet6'].replace('c0', '80');
        return fixture.probe(signal);
    } });
    assert.equal(polls, 2);
    assert.equal(fixture.peerCalls(), 1);
    assert.equal(ready.status, 'ready');
    assert.deepEqual(ready.interface, { index: 31, name: 'veth-owned' });
});

test('another interface address cannot satisfy the owned interface readiness', async () => {
    const fixture = probeFixture();
    fixture.files['/proc/net/if_inet6'] = fixture.files['/proc/net/if_inet6'].replace('veth-owned', 'veth-other');
    assert.equal((await fixture.probe()).status, 'pending');
});

test('an unrelated interface disappearing during enumeration does not fail owned readiness', async () => {
    assert.equal((await probeFixture({ vanished: true }).probe()).status, 'ready');
});

test('Docker outside the browser namespace and non-Linux hosts do not wait for an invisible interface', async () => {
    assert.equal((await probeFixture({ visible: false }).probe()).status, 'not-applicable');
    const probe = containerNetworkProbe('owned-container', { platform: 'darwin', peer: () => assert.fail('Should not query a Linux peer') });
    assert.equal((await probe()).status, 'not-applicable');
});

test('disabled IPv6 or disabled address generation does not require a link-local address', async () => {
    for (const settings of [{ disabled: '1' }, { generation: '1' }]) {
        const fixture = probeFixture(settings);
        delete fixture.files['/proc/net/if_inet6'];
        assert.equal((await fixture.probe()).status, 'ready');
    }
});

test('duplicate-address failure and genuine inspection errors are surfaced', async () => {
    await assert.rejects(waitForContainerNetwork('owned-container', { probe: probeFixture({ flags: '48' }).probe }), /duplicate-address detection failed/);
    await assert.rejects(waitForContainerNetwork('owned-container', { probe: async () => { throw new Error('permission denied'); } }), /permission denied/);
});

test('an unsettled interface times out instead of allowing browser startup', async () => {
    await assert.rejects(waitForContainerNetwork('owned-container', { timeoutMs: 20, probe: async () => ({ status: 'pending' }) }), /not ready before Chromium startup/);
});

test('cancellation interrupts polling and preserves the cancellation reason', async () => {
    const controller = new AbortController();
    const reason = new Error('fixture cancelled');
    const ready = waitForContainerNetwork('owned-container', { signal: controller.signal, probe: async () => ({ status: 'pending' }) });
    controller.abort(reason);
    await assert.rejects(ready, error => error === reason);
});

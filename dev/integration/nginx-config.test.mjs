import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const script = new URL('../../src/frontend/trusted-upstreams.sh', import.meta.url).pathname;

test('nginx upstream trust defaults to none and safely renders explicit addresses', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-nginx-config-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const config = join(directory, 'proxies.conf');
    const render = value => exec('sh', [script, config], { env: { ...process.env, CADDY_UI_TRUSTED_UPSTREAMS: value } });
    await render('');
    assert.doesNotMatch(await readFile(config, 'utf8'), /set_real_ip_from/);
    await render(' 192.0.2.5, 198.51.100.0/24, 2001:db8::/32 ');
    const trusted = await readFile(config, 'utf8');
    assert.match(trusted, /real_ip_header X-Forwarded-For;/);
    assert.match(trusted, /real_ip_recursive on;/);
    for (const address of ['192.0.2.5', '198.51.100.0/24', '2001:db8::/32']) {
        assert(trusted.includes(`set_real_ip_from ${address};`));
    }
    for (const invalid of ['0.0.0.0/0', '::/0', 'true', 'caddy', '192.0.2.5; include /tmp/evil', '192.0.2.5,,192.0.2.6']) {
        await assert.rejects(render(invalid), /CADDY_UI_TRUSTED_UPSTREAMS/);
        assert.equal(await readFile(config, 'utf8'), trusted, 'Rejected input must not replace the prior config');
    }
});

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const publisher = fileURLToPath(new URL('../../.github/scripts/publish-versions.sh', import.meta.url));
const branch = 'refs/heads/versions';
const realGit = execFileSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const execute = (args, cwd) => execFileSync(realGit, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

// A checkout whose origin is a local bare remote. `git` and `sleep` resolve to
// stubs in `bin` first, so a test can fail chosen git commands.
function fixture(t) {
    const directory = mkdtempSync(join(tmpdir(), 'publish-versions-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const remote = join(directory, 'remote.git');
    const checkout = join(directory, 'checkout');
    execute(['init', '--bare', '--initial-branch=main', remote]);
    execute(['clone', '--quiet', remote, checkout]);
    writeFileSync(join(checkout, 'README.md'), 'Application checkout\n');
    execute(['add', 'README.md'], checkout);
    execute(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Fixture'], checkout);
    execute(['push', '--quiet', 'origin', 'main'], checkout);
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(join(bin, 'sleep'), 0o755);
    const wrapper = body => {
        writeFileSync(join(bin, 'git'), `#!/usr/bin/env bash\nset -euo pipefail\n${body}\nexec "${realGit}" "$@"\n`);
        chmodSync(join(bin, 'git'), 0o755);
    };
    const run = () => spawnSync('bash', [publisher, 'edge', 'frontend=edge-abc1234'], {
        cwd: checkout, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MARKER: join(directory, 'marker') }, encoding: 'utf8', timeout: 15000,
    });
    const head = () => execute(['ls-remote', 'origin', branch], checkout).split(/\s/)[0];
    const versions = () => JSON.parse(execute(['--git-dir=' + remote, 'show', branch + ':versions.json']));
    const branches = () => execute(['for-each-ref', '--format=%(refname)', 'refs/heads/'], checkout);
    return { run, head, versions, branches, wrapper };
}

test('creates the versions branch, and retries an orphan publish whose push failed', t => {
    const f = fixture(t);
    f.wrapper('if [[ " $* " == *" push "* && ! -f "$MARKER" ]]; then touch "$MARKER"; exit 1; fi');
    const result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /attempt 1/);
    assert.deepEqual(f.versions().channels.edge.frontend, ['edge-abc1234']);
    assert.equal(f.branches(), 'refs/heads/main', 'no temporary branch is left behind');
});

test('a failed remote lookup cannot initialize a replacement versions branch', t => {
    const f = fixture(t);
    f.wrapper('if [[ " $* " == *" ls-remote "* ]]; then exit 128; fi');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refusing to initialize/);
    assert.equal(f.head(), '');
});

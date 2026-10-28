import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';
import { repositories } from '../../.github/scripts/dockerhub-pulls/collect.mjs';

const publisher = fileURLToPath(new URL('../../.github/scripts/dockerhub-pulls/publish.sh', import.meta.url));
const branch = 'refs/heads/dockerhub-pull-history';
const realGit = execFileSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const execute = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options }).trim();

function fixture(t) {
    const directory = mkdtempSync(join(tmpdir(), 'dockerhub-publish-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const remote = join(directory, 'remote.git');
    const checkout = join(directory, 'checkout');
    const git = (...args) => execute(realGit, args, { cwd: checkout });
    execute(realGit, ['init', '--bare', '--initial-branch=main', remote]);
    execute(realGit, ['clone', '--quiet', remote, checkout]);
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(checkout, 'README.md'), 'Application checkout\n');
    git('add', 'README.md');
    git('commit', '--quiet', '-m', 'Fixture application commit');
    git('push', '--quiet', 'origin', 'main');

    // Only HTTP is simulated; the publisher uses real worktrees, commits and
    // pushes against the local bare remote. Freeze the clock for same-day runs.
    const bootstrap = join(directory, 'http-fixture.mjs');
    const requests = join(directory, 'requests.txt');
    writeFileSync(bootstrap, `
        import { appendFileSync } from 'node:fs';
        const ActualDate = Date;
        globalThis.Date = class extends ActualDate {
            constructor(...args) { super(...(args.length ? args : [process.env.PULL_TEST_NOW || '2026-10-26T00:17:00.000Z'])); }
        };
        globalThis.fetch = async url => {
            appendFileSync(process.env.PULL_TEST_REQUESTS, url + '\\n');
            return process.env.PULL_TEST_FAIL && url.includes('frontend')
                ? new Response('unavailable', { status: 503 })
                : new Response(JSON.stringify({ pull_count: Number(process.env.PULL_TEST_COUNT || 85000) }));
        };
    `);
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(join(bin, 'sleep'), 0o755);
    const environment = {
        ...process.env, PATH: `${bin}:${process.env.PATH}`,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(bootstrap).href}`,
        PULL_TEST_REQUESTS: requests, PULL_TEST_REAL_GIT: realGit,
    };
    const run = (overrides = {}) => spawnSync('bash', [publisher], {
        cwd: checkout, env: { ...environment, ...overrides }, encoding: 'utf8', timeout: 15000,
    });
    const head = () => git('ls-remote', 'origin', branch).split(/\s/)[0];
    const readHistory = () => JSON.parse(git('--git-dir=' + remote, 'show', branch + ':history.json'));
    const wrapper = body => {
        writeFileSync(join(bin, 'git'), '#!/usr/bin/env bash\nset -euo pipefail\n' + body + '\nexec "$PULL_TEST_REAL_GIT" "$@"\n');
        chmodSync(join(bin, 'git'), 0o755);
    };
    const assertClean = () => {
        assert.equal(git('status', '--porcelain'), '');
        assert.equal(git('worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length, 1);
        assert.equal(git('for-each-ref', '--format=%(refname)', 'refs/heads/tmp/dockerhub-pulls-*'), '');
    };
    return { directory, checkout, remote, requests, git, run, head, readHistory, wrapper, assertClean };
}

function expectSuccess(result) {
    assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message || ''));
}

test('creates an orphan history branch, then keeps the first sample on a same-day rerun', t => {
    const f = fixture(t);
    expectSuccess(f.run());
    const initialHead = f.head();
    assert.equal(f.git('--git-dir=' + f.remote, 'rev-list', '--count', branch), '1');
    assert.equal(f.git('--git-dir=' + f.remote, 'ls-tree', '--name-only', branch), 'history.json');
    for (const repository of repositories) assert.equal(f.readHistory().repositories[repository][0].pullCount, 85000);
    assert.equal(readFileSync(f.requests, 'utf8').trim().split('\n').length, 2);

    const second = f.run({ PULL_TEST_COUNT: '99999', PULL_TEST_NOW: '2026-10-26T23:00:00.000Z' });
    expectSuccess(second);
    assert.match(second.stdout, /no commit created/);
    assert.equal(f.head(), initialHead);
    assert.equal(readFileSync(f.requests, 'utf8').trim().split('\n').length, 2, 'no same-day repoll');
    f.assertClean();
});

test('a failure on either repository cannot publish partial history', t => {
    const f = fixture(t);
    expectSuccess(f.run());
    const initialHead = f.head();
    const result = f.run({ PULL_TEST_FAIL: '1', PULL_TEST_NOW: '2026-10-27T00:17:00.000Z' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HTTP 503/);
    assert.equal(f.head(), initialHead);
    for (const repository of repositories) assert.equal(f.readHistory().repositories[repository].length, 1);
    f.assertClean();
});

test('a failed remote lookup cannot initialize a replacement data branch', t => {
    const f = fixture(t);
    f.wrapper('for argument in "$@"; do if [[ "$argument" == ls-remote ]]; then exit 128; fi; done');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refusing to initialize/);
    assert.equal(f.head(), '');
    f.assertClean();
});

test('missing and corrupt files on an existing data branch fail without resetting it', t => {
    const f = fixture(t);
    expectSuccess(f.run());
    f.git('fetch', '--quiet', 'origin', branch);
    f.git('checkout', '--quiet', '--detach', 'FETCH_HEAD');
    for (const body of [null, '{broken', 'null']) {
        const file = join(f.checkout, 'history.json');
        if (body === null) f.git('rm', '--quiet', 'history.json');
        else writeFileSync(file, body);
        f.git('add', '-A');
        f.git('commit', '--quiet', '-m', 'Fixture unreadable history');
        f.git('push', '--quiet', 'origin', 'HEAD:' + branch);
        const initialHead = f.head();
        assert.notEqual(f.run().status, 0);
        assert.equal(f.head(), initialHead);
        f.assertClean();
    }
});

test('a rejected first push reloads a concurrent writer history before retrying', t => {
    const f = fixture(t);
    const earlier = { version: 1, repositories: Object.fromEntries(repositories.map(repository => [repository, [
        { observedAt: '2026-10-25T00:17:00.000Z', pullCount: 123 },
    ]])) };
    const blob = execute(realGit, ['hash-object', '-w', '--stdin'], { cwd: f.checkout, input: JSON.stringify(earlier) });
    const tree = execute(realGit, ['mktree'], { cwd: f.checkout, input: `100644 blob ${blob}\thistory.json\n` });
    const racingCommit = f.git('commit-tree', tree, '-m', 'Fixture concurrent history');
    const marker = join(f.directory, 'raced');
    f.wrapper(`
        for argument in "$@"; do
            if [[ "$argument" == push && ! -f "$PULL_TEST_RACE_MARKER" ]]; then
                touch "$PULL_TEST_RACE_MARKER"
                "$PULL_TEST_REAL_GIT" push --quiet origin "$PULL_TEST_RACE_COMMIT:${branch}"
                break
            fi
        done
    `);
    const result = f.run({ PULL_TEST_RACE_MARKER: marker, PULL_TEST_RACE_COMMIT: racingCommit });
    expectSuccess(result);
    assert.match(result.stdout, /reloading history before retry/);
    for (const repository of repositories) {
        assert.deepEqual(f.readHistory().repositories[repository].map(sample => sample.pullCount), [123, 85000]);
    }
    assert.equal(f.git('--git-dir=' + f.remote, 'rev-list', '--count', branch), '2');
    f.assertClean();
});

test('the daily workflow uses the existing Git publication pattern without artifacts or the Git Data API', () => {
    const workflow = parse(readFileSync(new URL('../../.github/workflows/dockerhub-pulls.yml', import.meta.url), 'utf8'));
    assert.equal(workflow.on.schedule[0].cron, '17 0 * * *');
    assert('workflow_dispatch' in workflow.on);
    assert.equal(workflow.concurrency['cancel-in-progress'], false);
    assert.equal(workflow.jobs.collect.permissions.contents, 'write');
    assert.match(workflow.jobs.collect.if, /workflow_dispatch/);
    const steps = workflow.jobs.collect.steps;
    assert.equal(steps.find(step => step.uses?.startsWith('actions/checkout')).with['persist-credentials'], true);
    assert(steps.some(step => step.run === 'bash .github/scripts/dockerhub-pulls/publish.sh'));
    assert(!steps.some(step => /github-script|upload-artifact/.test(step.uses || '')));
    assert(!workflow.on.push && !workflow.on.pull_request);
});

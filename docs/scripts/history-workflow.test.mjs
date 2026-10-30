import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const workflow = readFileSync(new URL('../../.github/workflows/docs.yml', import.meta.url), 'utf8');
const archiveWorkflow = readFileSync(new URL('../../.github/workflows/documentation-history.yml', import.meta.url), 'utf8');
const job = name => workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z]+:|$(?![\\s\\S]))`, 'm'))[1];
function condition(name) {
    const source = job(name);
    return source.match(/^ {4}if: >-\n((?: {6}.+\n)+)/m)?.[1].trim().split('\n').map(line => line.trim()).join(' ')
        || source.match(/^ {4}if: (.+)$/m)[1];
}
function context(event, { fork = false, archive = false, collect = false, source, conclusion = 'success', ref = 'refs/heads/main',
    collection = 'skipped', archival = 'skipped', build = 'success', cancelled = false } = {}) {
    const repository = fork ? 'juscghwe/caddy-ui' : 'zackwag/caddy-ui';
    return { inputs: { archive_history: archive, collect_history: collect }, cancelled: () => cancelled,
        needs: { collect: { result: collection }, archive: { result: archival }, build: { result: build } },
        github: { repository, ref, sha: 'trusted-event-sha', event_name: event,
            event: { repository: { fork }, workflow_run: { head_repository: { full_name: source || repository }, conclusion } } } };
}
const eligible = (name, event) => runInNewContext(`Boolean(${condition(name).replace(/^\$\{\{\s*|\s*\}\}$/g, '')})`, event);

test('the reusable archive serializes writers without replacing a second pending request', () => {
    assert.match(archiveWorkflow, /^ {2}group: historical-documentation-archive$/m);
    assert.match(archiveWorkflow, /^ {2}queue: max$/m);
    assert.match(archiveWorkflow, /^ {2}cancel-in-progress: false$/m);
});

test('documentation preserves multiple pending publications and pins the updated collector', () => {
    assert.match(workflow, /^ {2}queue: max$/m);
    assert.match(workflow, /^ {2}cancel-in-progress: false$/m);
    const pinnedWorkflow = job('archive').match(/documentation-history\.yml@([a-f0-9]{40})/)[1];
    const pinnedTooling = job('archive').match(/tooling_ref: ([a-f0-9]{40})/)[1];
    assert.equal(pinnedWorkflow, pinnedTooling);
    assert.notEqual(pinnedWorkflow, '1d01a539cfbbce29750e0820cdf194cc56df3765', 'the old collector still replaces pending writers');
});

test('Pages deploys a successful build despite skipped ancestors, but never a failed or cancelled build', () => {
    // An explicit status function overrides Actions' implicit success(), which
    // otherwise includes skipped archive/collect jobs in the dependency chain.
    assert.match(condition('deploy'), /!cancelled\(\)/);
    assert.match(condition('deploy'), /needs\.build\.result == 'success'/);
    for (const event of ['push', 'workflow_run', 'workflow_dispatch']) {
        assert.equal(eligible('deploy', context(event)), true);
        for (const build of ['failure', 'cancelled', 'skipped']) {
            assert.equal(eligible('deploy', context(event, { build })), false);
        }
        assert.equal(eligible('deploy', context(event, { cancelled: true })), false);
    }
});

test('release-driven documentation keeps collection in the fork and makes publication wait for it', () => {
    const group = workflow.match(/^ {2}group: documentation-\$\{\{ github.ref \}\}-\$\{\{ (.+) \}\}$/m)[1];
    assert.match(workflow, /^ {2}schedule:\n {4}- cron: '17 4 \* \* 1'$/m);
    assert.doesNotMatch(workflow, /archive_request|^run-name:/m);
    assert.match(job('build'), /^ {4}needs: \[archive, collect\]/m);
    for (const event of ['push', 'workflow_run']) {
        assert.equal(runInNewContext(group, context(event)), 'site', 'upstream publications share one concurrency group');
    }
    assert.equal(eligible('archive', context('workflow_run', { fork: true })), false);
    assert.equal(eligible('collect', context('workflow_run', { fork: true })), false);
    assert.equal(eligible('build', context('workflow_run', { fork: true })), false);
    assert.equal(eligible('archive', context('workflow_run')), false);
    assert.equal(eligible('collect', context('workflow_run')), true);
    assert.equal(eligible('build', context('workflow_run', { collection: 'success' })), true);
    assert.equal(eligible('deploy', context('workflow_run')), true);
    for (const event of ['push', 'pull_request', 'workflow_dispatch']) {
        assert.equal(eligible('collect', context(event)), false, 'ordinary site updates do not request collection');
    }
    assert.equal(eligible('collect', context('workflow_dispatch', { collect: true })), true);
    assert.equal(eligible('collect', context('workflow_dispatch', { collect: true, fork: true })), false);
    assert.equal(eligible('collect', context('workflow_dispatch', { collect: true, ref: 'refs/heads/feature' })), false);
    for (const collection of ['failure', 'cancelled']) {
        assert.equal(eligible('build', context('workflow_run', { collection })), false, 'collection failures cannot publish an older archive');
    }
    assert.equal(eligible('build', context('workflow_run', { archival: 'failure' })), false);
    assert.equal(eligible('build', context('workflow_run', { cancelled: true })), false);
    assert.equal(eligible('archive', context('workflow_dispatch', { fork: true, archive: true })), true);
    assert.equal(eligible('build', context('workflow_dispatch', { fork: true, archive: true })), false);
    for (const fork of [true, false]) {
        const preview = context('pull_request', { fork });
        assert.equal(eligible('archive', preview), false);
        assert.equal(eligible('build', preview), true);
        assert.equal(eligible('deploy', preview), false);
        assert.equal(eligible('deploy', context('workflow_dispatch', { fork, ref: 'refs/heads/feature' })), false);
    }
    assert.equal(eligible('deploy', context('push', { fork: true })), false);
    assert.equal(eligible('deploy', context('push')), true);
});

test('weekly catch-up collects before publishing only in upstream and blocks on failed collection', () => {
    assert.equal(eligible('collect', context('schedule')), true);
    assert.equal(eligible('build', context('schedule', { collection: 'success' })), true);
    assert.equal(eligible('deploy', context('schedule')), true);
    assert.equal(eligible('collect', context('schedule', { ref: 'refs/heads/feature' })), false);
    for (const collection of ['failure', 'cancelled']) {
        assert.equal(eligible('build', context('schedule', { collection })), false);
    }
    for (const name of ['archive', 'collect', 'build', 'deploy']) {
        assert.equal(eligible(name, context('schedule', { fork: true })), false, 'the fork has no independent scheduled work');
    }
    assert.doesNotMatch(archiveWorkflow, /^ {2}schedule:/m);
});

test('release completion cannot publish foreign artifacts or run archive writes from PRs', () => {
    for (const fork of [true, false]) {
        for (const overrides of [{ source: 'untrusted/caddy-ui' }, { conclusion: 'failure' }]) {
            const rejected = context('workflow_run', { fork, ...overrides });
            assert.equal(eligible('archive', rejected), false);
            assert.equal(eligible('collect', rejected), false);
            assert.equal(eligible('build', rejected), false);
        }
    }
    const checkoutRef = job('build').match(/ref: \$\{\{ (.+) \}\}/)[1];
    assert.equal(runInNewContext(checkoutRef, context('workflow_run')), 'main');
    assert.equal(runInNewContext(checkoutRef, context('pull_request')), 'trusted-event-sha');
    assert.match(workflow, /permissions:\n {2}contents: read/);
    assert.match(job('archive'), /permissions:\n {6}contents: write/);
    assert.doesNotMatch(job('build'), /contents: write|history-crawl\.mjs|actions\/cache/);
    assert.match(job('build'), /history-archive\.mjs restore --repository "\$DOCUMENTATION_ARCHIVE_REPOSITORY"/);
    assert.match(job('build'), /--require-collected "\$REQUIRE_COLLECTED"/);
    assert.match(job('collect'), /ref: main/);
    assert.match(job('collect'), /secrets\.DOCS_ARCHIVE_DISPATCH_TOKEN/);
    assert.doesNotMatch(job('build'), /secrets\.DOCS_ARCHIVE_DISPATCH_TOKEN/);
});

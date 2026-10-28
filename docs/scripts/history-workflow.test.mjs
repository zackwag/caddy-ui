import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const workflow = readFileSync(new URL('../../.github/workflows/docs.yml', import.meta.url), 'utf8');
const job = name => workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z]+:|$(?![\\s\\S]))`, 'm'))[1];
function condition(name) {
    const source = job(name);
    return source.match(/^ {4}if: >-\n((?: {6}.+\n)+)/m)?.[1].trim().split('\n').map(line => line.trim()).join(' ')
        || source.match(/^ {4}if: (.+)$/m)[1];
}
function context(event, { fork = false, archive = false, source, conclusion = 'success', ref = 'refs/heads/main' } = {}) {
    const repository = fork ? 'juscghwe/caddy-ui' : 'zackwag/caddy-ui';
    return { inputs: { archive_history: archive }, github: { repository, ref, sha: 'trusted-event-sha', event_name: event,
        event: { repository: { fork }, workflow_run: { head_repository: { full_name: source || repository }, conclusion } } } };
}
const eligible = (name, event) => runInNewContext(`Boolean(${condition(name)})`, event);

test('documentation events keep archive writes in the fork and publication in the upstream repository', () => {
    const group = workflow.match(/^ {2}group: documentation-\$\{\{ github.ref \}\}-\$\{\{ (.+) \}\}$/m)[1];
    for (const event of ['push', 'schedule', 'workflow_run']) {
        assert.equal(runInNewContext(group, context(event)), 'site', 'upstream publications share one concurrency group');
    }
    for (const event of ['schedule', 'workflow_run']) {
        assert.equal(eligible('archive', context(event, { fork: true })), true);
        assert.equal(eligible('build', context(event, { fork: true })), false);
        assert.equal(eligible('archive', context(event)), false);
        assert.equal(eligible('build', context(event)), true);
        assert.equal(eligible('deploy', context(event)), true);
    }
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

test('release completion cannot publish foreign artifacts or run archive writes from PRs', () => {
    for (const fork of [true, false]) {
        for (const overrides of [{ source: 'untrusted/caddy-ui' }, { conclusion: 'failure' }]) {
            const rejected = context('workflow_run', { fork, ...overrides });
            assert.equal(eligible('archive', rejected), false);
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
});

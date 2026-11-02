import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const document = parse(readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'));
const jobs = document.jobs;
const versionStep = jobs['release-info'].steps.find(step => step.id === 'version');
const stepUsing = (job, action) => job.steps.find(step => step.uses?.startsWith(action + '@'));
function directory(t) {
    const path = mkdtempSync(join(tmpdir(), 'caddy-ui-release-'));
    t.after(() => rmSync(path, { recursive: true, force: true }));
    return path;
}
const run = (script, cwd, env) => execFileSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 5000,
});

test('both release images are scheduled without path detection and share version/tag rules', () => {
    assert.deepEqual(document.on.push.tags, ['v*']);
    assert.match(document.on.workflow_dispatch.inputs.tag.description, /both images/);
    assert.deepEqual(Object.keys(jobs['release-info'].outputs), ['target_ref', 'version', 'major_minor']);
    assert.doesNotMatch(versionStep.run, /git (?:diff|tag|rev-list)|CHANGED|PREV_TAG/);
    for (const component of ['backend', 'frontend']) {
        const job = jobs['docker-' + component];
        assert.equal(job.needs, 'release-info');
        assert.equal(job.if, undefined, component + ' is not conditional on changed paths');
        assert.equal(stepUsing(job, 'actions/checkout').with.ref, '${{ needs.release-info.outputs.target_ref }}');
        assert.equal(stepUsing(job, 'docker/metadata-action').with.images, 'zackwag/caddy-ui-' + component);
        const build = stepUsing(job, 'docker/build-push-action');
        assert.equal(build.with.push, true);
        assert.equal(build.with.tags, '${{ steps.meta.outputs.tags }}');
        assert.equal(build.with['build-args'].trim(), 'APP_VERSION=${{ needs.release-info.outputs.version }}');
    }
    const tags = stepUsing(jobs['docker-backend'], 'docker/metadata-action').with.tags;
    assert.equal(tags, stepUsing(jobs['docker-frontend'], 'docker/metadata-action').with.tags);
    assert.match(tags, /value=\$\{\{ needs.release-info.outputs.version \}\}/);
    assert.match(tags, /value=latest,enable=\$\{\{ github.event_name == 'push' \}\}/);
    for (const name of ['dockerhub-docs', 'release-notes']) {
        assert.deepEqual(jobs[name].needs, ['docker-backend', 'docker-frontend']);
        assert.equal(jobs[name].if, "github.event_name == 'push'", 'default success gating applies');
    }
    const descriptions = jobs['dockerhub-docs'].steps.filter(step => step.uses?.startsWith('peter-evans/dockerhub-description@'));
    assert.deepEqual(descriptions.map(step => step.with.repository).sort(), ['zackwag/caddy-ui-backend', 'zackwag/caddy-ui-frontend']);
    assert(descriptions.every(step => step.if === undefined));
});

test('version resolution and build-context scripts support current and historical tags/layouts', t => {
    const cwd = directory(t);
    assert.equal(versionStep.env.TARGET_REF, "${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref_name }}");
    for (const [tag, version, majorMinor] of [['v3.7.1', '3.7.1', '3.7'], ['v1.13', '1.13', '1.13']]) {
        const output = join(cwd, tag + '.outputs');
        run(versionStep.run, cwd, { TARGET_REF: tag, GITHUB_OUTPUT: output });
        assert.equal(readFileSync(output, 'utf8'), `target_ref=${tag}\nversion=${version}\nmajor_minor=${majorMinor}\n`);
    }
    for (const component of ['backend', 'frontend']) {
        const script = jobs['docker-' + component].steps.find(step => step.id === 'context').run;
        for (const layout of ['src/', '']) {
            const fixture = join(cwd, component + (layout ? '-current' : '-legacy'));
            const path = join(fixture, layout, component);
            mkdirSync(path, { recursive: true });
            writeFileSync(join(path, 'Dockerfile'), 'FROM scratch\n');
            const output = join(fixture, 'context.outputs');
            run(script, fixture, { GITHUB_OUTPUT: output });
            assert.equal(readFileSync(output, 'utf8'), `path=./${layout}${component}\n`);
        }
    }
});

test('version recording retains success gates and forwards only nonempty component arguments', t => {
    const job = jobs.versions;
    assert.deepEqual(job.needs, ['release-info', 'docker-backend', 'docker-frontend']);
    assert.equal(job.if, "github.event_name == 'push' && always() && !cancelled()");
    const step = job.steps.find(step => step.run);
    for (const component of ['backend', 'frontend']) {
        assert.equal(step.env[component.toUpperCase()], '${{ needs.docker-' + component + ".result == 'success' && needs.release-info.outputs.version || '' }}");
    }
    const cwd = directory(t);
    const scripts = join(cwd, '.github/scripts');
    mkdirSync(scripts, { recursive: true });
    writeFileSync(join(scripts, 'publish-versions.sh'), '#!/usr/bin/env bash\nprintf \'%s\\0\' "$@" > "$CAPTURE"\n', { mode: 0o755 });
    const capture = join(cwd, 'arguments');
    for (const components of [[], ['backend'], ['frontend'], ['backend', 'frontend']]) {
        rmSync(capture, { force: true });
        run(step.run, cwd, { CAPTURE: capture, BACKEND: components.includes('backend') ? '3.7.1' : '', FRONTEND: components.includes('frontend') ? '3.7.1' : '' });
        if (!components.length) assert.throws(() => readFileSync(capture), { code: 'ENOENT' });
        else assert.deepEqual(readFileSync(capture, 'utf8').split('\0').slice(0, -1), ['stable', ...components.map(component => component + '=3.7.1')]);
    }
});

test('release notes preserve existing text and append both image commands using the selected tag', t => {
    const cwd = directory(t);
    const step = jobs['release-notes'].steps[0];
    assert.equal(step.env.RELEASE_TAG, '${{ github.ref_name }}');
    for (const component of ['backend', 'frontend']) {
        assert.equal(step.env[component.toUpperCase() + '_VERSION'], '${{ needs.docker-' + component + '.outputs.version }}');
    }
    writeFileSync(join(cwd, 'gh'), `#!/usr/bin/env bash
if [[ "$1 $2" == 'release view' && "$3" == 'v3.7.1' ]]; then
    printf '%s\\n' 'Existing release notes'
elif [[ "$1 $2" == 'release edit' && "$3" == 'v3.7.1' && "$4" == '--notes-file' ]]; then
    cp "$5" "$CAPTURE"
else
    exit 1
fi
`, { mode: 0o755 });
    const capture = join(cwd, 'published-notes');
    run(step.run, cwd, { PATH: cwd + ':' + process.env.PATH, RUNNER_TEMP: cwd, CAPTURE: capture,
        RELEASE_TAG: 'v3.7.1', BACKEND_VERSION: '3.7.1', FRONTEND_VERSION: '3.7.1' });
    assert.equal(readFileSync(capture, 'utf8'), 'Existing release notes\n\n### Docker images\n\n```\ndocker pull zackwag/caddy-ui-backend:3.7.1\ndocker pull zackwag/caddy-ui-frontend:3.7.1\n```\n');
});

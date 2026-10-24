import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const workflow = channel => parse(readFileSync(join(root, '.github/workflows', channel + '.yml'), 'utf8'));
const publicationChannels = document => Object.values(document.jobs).flatMap(job =>
    (job.steps || []).flatMap(step => [...(step.run || '').matchAll(/publish-versions\.sh\s+(\S+)/g)]
        .map(match => match[1])));

test('version publication is detected through common shell command prefixes', () => {
    for (const prefix of ['.github/scripts/', 'bash .github/scripts/', './.github/scripts/', '"$GITHUB_WORKSPACE"/.github/scripts/']) {
        const document = { jobs: { versions: { steps: [{ run: `${prefix}publish-versions.sh beta` }] } } };
        assert.deepEqual(publicationChannels(document), ['beta'], prefix);
    }
});

for (const channel of ['beta', 'edge']) {
    test(`${channel} publishes only its own image tags and version channel`, () => {
        const document = workflow(channel);
        for (const component of ['backend', 'frontend']) {
            const steps = document.jobs['docker-' + component].steps;
            const metadata = steps.filter(step => step.uses?.startsWith('docker/metadata-action@'));
            assert.equal(metadata.length, 1, component + ' has one image-tag source');
            assert.deepEqual(metadata[0].with.tags.trim().split(/\r?\n/).map(line => line.trim()),
                ['type=raw,value=' + channel], component + ' cannot publish edge, beta or stable aliases belonging to another channel');
            assert(!metadata[0].with.flavor || metadata[0].with.flavor.trim() === 'latest=false', 'no implicit latest alias');
            const builds = steps.filter(step => step.uses?.startsWith('docker/build-push-action@'));
            assert.equal(builds.length, 1);
            assert.equal(builds[0].with.tags, '${{ steps.meta.outputs.tags }}');
        }
        assert.deepEqual(publicationChannels(document), [channel], 'version records follow the published image channel');
    });
}

test('release publishes no beta or edge aliases and records only the stable channel', () => {
    const document = workflow('release');
    for (const component of ['backend', 'frontend']) {
        const steps = document.jobs['docker-' + component].steps;
        const metadata = steps.filter(step => step.uses?.startsWith('docker/metadata-action@'));
        assert.equal(metadata.length, 1, component + ' has one image-tag source');
        for (const tag of metadata[0].with.tags.trim().split(/\r?\n/)) {
            const value = tag.split(',').map(field => field.trim()).find(field => field.startsWith('value='))?.slice('value='.length).trim();
            assert(!['edge', 'beta'].includes(value), component + ' cannot publish a prerelease alias');
        }
        const builds = steps.filter(step => step.uses?.startsWith('docker/build-push-action@'));
        assert.equal(builds.length, 1);
        assert.equal(builds[0].with.tags, '${{ steps.meta.outputs.tags }}');
    }
    assert.deepEqual(publicationChannels(document), ['stable']);
});

test('edge follows main pushes while beta remains manually selected', () => {
    assert.deepEqual(workflow('edge').on.push.branches, ['main']);
    assert(!Object.hasOwn(workflow('edge').on, 'pull_request'));
    assert.deepEqual(Object.keys(workflow('beta').on), ['workflow_dispatch']);
});

// Exercises the record-versions CLI with explicitly selected components, not
// GitHub's needs expressions or the workflow shell's success/empty-ARGS gates.
test('beta record-versions CLI updates preserve other channels and omitted components', t => {
    const directory = mkdtempSync(join(tmpdir(), 'caddy-ui-channels-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const original = { schema: 1, channels: {
        stable: { backend: ['3.7.0'], frontend: ['3.7.0'] },
        edge: { backend: ['edge-1111111'], frontend: ['edge-2222222'] },
        beta: { backend: ['beta-3333333'], frontend: ['beta-4444444'] },
    } };
    const file = join(directory, 'versions.json');
    for (const components of [['backend'], ['frontend'], ['backend', 'frontend']]) {
        writeFileSync(file, JSON.stringify(original));
        for (const channel of publicationChannels(workflow('beta'))) {
            execFileSync(process.execPath, [join(root, '.github/scripts/record-versions.mjs'), file, channel,
                ...components.map(component => `${component}=beta-abcdef0`)]);
        }
        const actual = JSON.parse(readFileSync(file, 'utf8'));
        assert.deepEqual(actual.channels.stable, original.channels.stable);
        assert.deepEqual(actual.channels.edge, original.channels.edge);
        for (const component of ['backend', 'frontend']) {
            assert.deepEqual(actual.channels.beta[component], components.includes(component)
                ? ['beta-abcdef0', ...original.channels.beta[component]] : original.channels.beta[component]);
        }
    }
});

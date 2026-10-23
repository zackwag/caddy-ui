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
    (job.steps || []).flatMap(step => [...(step.run || '').matchAll(/^\s*\.github\/scripts\/publish-versions\.sh\s+(\S+)/gm)]
        .map(match => match[1])));

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

test('edge follows main pushes while beta remains manually selected', () => {
    assert.deepEqual(workflow('edge').on.push.branches, ['main']);
    assert.deepEqual(Object.keys(workflow('edge').on), ['push']);
    assert.deepEqual(Object.keys(workflow('beta').on), ['workflow_dispatch']);
});

test('beta version updates preserve stable, edge and any component that was not published', t => {
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

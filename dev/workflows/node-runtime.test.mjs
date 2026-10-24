import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const root = new URL('../../', import.meta.url);
const version = readFileSync(new URL('.node-version', root), 'utf8').trim();

for (const component of ['backend', 'frontend']) {
    test(`${component} Docker Node stages match the tested runtime`, () => {
        assert.match(version, /^\d+$/, '.node-version declares one production Node major');
        const dockerfile = readFileSync(new URL(`src/${component}/Dockerfile`, root), 'utf8');
        const stages = [...dockerfile.matchAll(/^FROM\s+node:(\d+)(?=[.\s-]|$)/gim)];
        assert(stages.length > 0, `${component}: has a Node base stage`);
        for (const stage of stages) {
            assert.equal(stage[1], version, `${component}: update .node-version and Docker stages together`);
        }
    });
}

test('package manifests do not declare a different Node runtime', () => {
    const manifests = ['package.json', 'src/backend/package.json', 'src/frontend/package.json', 'dev/package.json', 'docs/package.json'];
    for (const manifest of manifests) {
        const engines = JSON.parse(readFileSync(new URL(manifest, root), 'utf8')).engines;
        if (engines?.node === undefined) {
            continue;
        }
        assert.equal(engines.node, `>=${version}`, `${manifest}: omit engines.node or require the .node-version major`);
    }
});

test('workflow Node setup consistently reads the production runtime file', () => {
    const directory = new URL('.github/workflows/', root);
    let setups = 0;
    for (const file of readdirSync(directory).filter(file => /\.ya?ml$/.test(file))) {
        const document = parse(readFileSync(new URL(file, directory), 'utf8'));
        for (const [name, job] of Object.entries(document.jobs)) {
            for (const step of job.steps || []) {
                if (!step.uses?.startsWith('actions/setup-node@')) continue;
                setups++;
                const location = `${file}/${name}`;
                assert.equal(step.with?.['node-version-file'], '.node-version', `${location}: uses the shared runtime`);
                assert.equal(step.with?.['node-version'], undefined, `${location}: cannot override the runtime file`);
            }
        }
    }
    assert(setups > 0, 'workflow Node setup was found');
});

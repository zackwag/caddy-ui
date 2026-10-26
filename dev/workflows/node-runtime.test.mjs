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

test('workflow Node setup reads the production runtime except for the explicit manual Node 26 trial', () => {
    const directory = new URL('.github/workflows/', root);
    let setups = 0;
    let trials = 0;
    for (const file of readdirSync(directory).filter(file => /\.ya?ml$/.test(file))) {
        const document = parse(readFileSync(new URL(file, directory), 'utf8'));
        for (const [name, job] of Object.entries(document.jobs)) {
            for (const step of job.steps || []) {
                if (!step.uses?.startsWith('actions/setup-node@')) continue;
                setups++;
                const location = `${file}/${name}`;
                if (file === 'node26-trial.yml') {
                    trials++;
                    assert.deepEqual(Object.keys(document.on).sort(), ['workflow_call', 'workflow_dispatch']);
                    assert.equal(document.permissions.contents, 'read', 'the trial cannot publish');
                    assert.equal(name, 'compatibility');
                    assert.equal(job.if, "github.event_name == 'workflow_dispatch'", 'the trial requires a manual request');
                    assert.equal(step.with?.['node-version'], 26, 'the exception is only for the Node 26 candidate');
                    assert.equal(step.with?.['node-version-file'], undefined);
                    continue;
                }
                assert.equal(step.with?.['node-version-file'], '.node-version', `${location}: uses the shared runtime`);
                assert.equal(step.with?.['node-version'], undefined, `${location}: cannot override the runtime file`);
            }
        }
    }
    assert(setups > 0, 'workflow Node setup was found');
    assert.equal(trials, 1, 'exactly one setup selects the manual candidate runtime');
});

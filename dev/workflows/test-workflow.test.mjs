import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const root = new URL('../../', import.meta.url);
const workflow = parse(readFileSync(new URL('.github/workflows/test.yml', root), 'utf8'));
const development = JSON.parse(readFileSync(new URL('dev/package.json', root), 'utf8'));
const commands = job => job.steps.flatMap(step => step.run ? [step.run] : []);

test('independent suites can start together and all contribute to the existing Test result', () => {
    const gate = workflow.jobs['test-required'];
    const suites = Object.keys(workflow.jobs).filter(name => name !== 'test-required');
    assert.equal(gate.name, 'Test');
    assert.equal(gate.if, 'always()');
    assert.deepEqual([...gate.needs].sort(), suites.sort());
    for (const name of suites) {
        assert.equal(workflow.jobs[name].needs, undefined, name + ' has no serial job dependency');
        assert.equal(workflow.jobs[name].if, undefined, name + ' is not conditionally skipped');
        assert(!workflow.jobs[name]['continue-on-error'], name + ' failures are required');
        assert(workflow.jobs[name].steps.every(step => !step['continue-on-error']), name + ' steps cannot ignore failures');
    }
    assert.equal(workflow.jobs.browser.strategy['fail-fast'], false);
});

test('the split retains tooling, integration, capture and both browser groups', () => {
    for (const command of ['npm run lint:dev-caddy', 'npm run test:playground', 'npm run test:dev-caddy', 'npm run test:workflows']) {
        assert(commands(workflow.jobs.tooling).includes(command), command);
    }
    assert(commands(workflow.jobs.integration).includes('npm run test:dev-caddy:integration'));
    assert(commands(workflow.jobs.capture).includes('npm run test:screenshots --prefix docs'));
    const groups = workflow.jobs.browser.strategy.matrix.include;
    assert.deepEqual(groups.map(group => group.command).sort(), [
        'npm run test:dev-caddy:e2e:auth', 'npm run test:dev-caddy:e2e:configuration',
    ]);
    assert(commands(workflow.jobs.browser).includes('${{ matrix.command }}'));
    assert(!commands(workflow.jobs.integration).some(command => command.includes('playwright install')));
    assert(!commands(workflow.jobs.tooling).some(command => /docker|playwright install/.test(command)));
});

test('browser groups preserve every file from the full local suite exactly once', () => {
    const files = command => command.split(/\s+/).filter(argument => argument.endsWith('.mjs'));
    const complete = files(development.scripts['test:e2e']);
    const grouped = ['test:e2e:auth', 'test:e2e:configuration'].flatMap(name => {
        assert(development.scripts[name].includes('--test-concurrency=1'));
        return files(development.scripts[name]);
    });
    assert.equal(new Set(grouped).size, grouped.length, 'no duplicated browser files');
    assert.deepEqual(grouped.sort(), complete.sort(), 'no omitted browser files');
    for (const file of grouped) assert(readFileSync(new URL('dev/' + file, root), 'utf8').length > 0);
});

test('Test rejects failures, cancellations and skipped suites instead of passing through them', () => {
    const gate = workflow.jobs['test-required'];
    const step = gate.steps.find(step => step.run);
    assert.equal(step.env.JOB_RESULTS, '${{ toJSON(needs) }}');
    const results = Object.fromEntries(gate.needs.map(name => [name, { result: 'success' }]));
    const execute = () => spawnSync('bash', ['-e', '-c', step.run], {
        cwd: fileURLToPath(root), env: { ...process.env, JOB_RESULTS: JSON.stringify(results) }, encoding: 'utf8',
    });
    assert.equal(execute().status, 0);
    for (const name of gate.needs) {
        results[name].result = 'failure';
        assert.equal(execute().status, 1, name + ' failure blocks Test');
        results[name].result = 'success';
    }
    for (const result of ['cancelled', 'skipped']) {
        results.browser.result = result;
        assert.equal(execute().status, 1, result + ' browser matrix blocks Test');
    }
});

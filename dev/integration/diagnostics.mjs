import assert from 'node:assert/strict';
import test from 'node:test';
import { useTestStack } from './stack.mjs';

const invalid = ':80 {\n    integration_diagnostic_bad_directive\n}\n';

test('real Caddy diagnostics preserve correlation, paths, codes and severity', { timeout: 120000 }, async t => {
    const stack = await useTestStack(t);
    const alpha = stack.instances.get('alpha');
    const original = (await stack.api('/caddyfile')).data;

    async function diagnostics(response) {
        assert.match(response.requestId, /^[a-f0-9-]{36}$/);
        assert.equal(response.data.requestId, response.requestId);
        const logs = await stack.api('/logs/app');
        assert.equal(logs.status, 200);
        return logs.data.entries.filter(entry => entry.requestId === response.requestId);
    }

    await t.test('updating an unknown instance returns a correlated 404 instead of a save failure', async () => {
        const response = await stack.api('/instances/missing-diagnostic-instance', {
            method: 'PUT', body: { name: 'Missing instance' },
        });
        assert.equal(response.status, 404);
        assert.deepEqual(response.data, { code: 'INSTANCE_NOT_FOUND', error: 'Operation failed', requestId: response.requestId });
        const entries = await diagnostics(response);
        const failure = entries.find(entry => entry.message === 'API request failed');
        assert.equal(failure.code, 'INSTANCE_NOT_FOUND');
        assert.equal(failure.path, '/api/instances/missing-diagnostic-instance');
        assert.equal(failure.level, 'warn');
        assert.equal((await stack.api('/instances')).data.length, 1);
    });

    await t.test('mounted validation and save routes keep their complete paths and semantic codes', async () => {
        for (const [path, method] of [
            ['/caddyfile/validations?fmt=false&probe=omit-from-log', 'POST'],
            ['/caddyfile?fmt=false&sort=false', 'PUT'],
        ]) {
            const response = await stack.api(path, { method, body: invalid, plain: true });
            assert.equal(response.status, 422);
            assert.equal(response.data.code, 'CADDYFILE_VALIDATION_FAILED');
            const entries = await diagnostics(response);
            const failure = entries.find(entry => entry.message === 'API request failed');
            assert.equal(failure.path, '/api' + path.split('?')[0]);
            assert.equal(failure.level, 'warn');
            assert.match(JSON.stringify(failure.detail), /integration_diagnostic_bad_directive/);
            assert(entries.some(entry => entry.message === method + ' ' + failure.path));
            assert(!JSON.stringify(entries).includes('omit-from-log'));
            assert.equal((await stack.api('/caddyfile')).data, original);
            assert.match(await (await fetch(alpha.httpUrl)).text(), /test instance: alpha/);
        }
    });

    await t.test('missing source files have a typed public error with technical causes in logs', async () => {
        const missing = '/data/dev-caddy/missing-diagnostic.Caddyfile';
        await stack.api('/instances/default', { method: 'PUT', body: { configPath: missing } });
        try {
            for (const query of ['', '?download=true']) {
                const response = await stack.api('/caddyfile' + query);
                assert.equal(response.status, 500);
                assert.deepEqual(response.data, { code: 'CADDYFILE_READ_FAILED', error: 'Operation failed', requestId: response.requestId });
                const entries = await diagnostics(response);
                const failure = entries.find(entry => entry.message === 'API request failed');
                assert.equal(failure.path, '/api/caddyfile');
                assert.equal(failure.level, 'error');
                assert.equal(failure.causes[0].code, 'CADDYFILE_READ_FAILED');
                assert.equal(failure.causes[0].context.instanceId, 'default');
                assert(failure.causes.length >= 2);
                assert.match(JSON.stringify(failure.causes), /missing-diagnostic/);
            }
        } finally {
            await stack.api('/instances/default', { method: 'PUT', body: { configPath: alpha.instance.configPath } });
        }
    });

    await t.test('unavailable metrics retain the HTTP 200 contract and log one warning with causes', async () => {
        await stack.api('/instances/default', { method: 'PUT', body: { adminUrl: alpha.instance.adminUrl + '/nonexistent-test-path' } });
        try {
            const response = await stack.api('/status/process?probe=omit-from-log');
            assert.equal(response.status, 200);
            assert.equal(response.data.ok, false);
            assert.equal(response.data.code, 'METRICS_UNAVAILABLE');
            const entries = await diagnostics(response);
            const failures = entries.filter(entry => entry.code === 'METRICS_UNAVAILABLE');
            assert.equal(failures.length, 1);
            assert.equal(failures[0].message, 'API request failed');
            assert.equal(failures[0].path, '/api/status/process');
            assert.equal(failures[0].level, 'warn');
            assert.match(failures[0].causes[1].message, /Metrics endpoint unavailable: 404/);
            assert(!JSON.stringify(entries).includes('omit-from-log'));
        } finally {
            await stack.api('/instances/default', { method: 'PUT', body: { adminUrl: alpha.instance.adminUrl } });
        }
    });

    await t.test('force-save warnings correlate with logs and do not replace the active config', async () => {
        try {
            const response = await stack.api('/caddyfile?validate=false&fmt=false&sort=false', { method: 'PUT', body: invalid, plain: true });
            assert.equal(response.status, 200);
            assert.equal(response.data.ok, true);
            assert(response.data.warning);
            const entries = await diagnostics(response);
            const warning = entries.find(entry => entry.message === 'API returned a warning');
            assert.equal(warning.path, '/api/caddyfile');
            assert.equal(warning.level, 'warn');
            assert.equal(warning.code, response.data.warningCode);
            assert.equal((await stack.api('/caddyfile')).data, invalid);
            assert.match(await (await fetch(alpha.httpUrl)).text(), /test instance: alpha/);
        } finally {
            assert.equal((await stack.api('/caddyfile?fmt=false&sort=false', { method: 'PUT', body: original, plain: true })).status, 200);
        }
    });
});
